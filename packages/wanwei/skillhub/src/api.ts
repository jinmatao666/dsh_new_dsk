/** SkillHub HTTP adapter. Remote responses stay outside the product UI contract. */
import { createHash } from 'node:crypto'

/** Deployment-owned network and resource limits. */
export interface ApiConfig {
  /** HTTPS origin of the upstream API. */
  baseURL: string
  /** Maximum request duration in milliseconds. */
  timeoutMs: number
  /** Maximum streamed JSON response size in bytes. */
  maxJsonBytes: number
  /** Maximum compressed archive size in bytes. */
  maxArchiveBytes: number
  /** Exact hostnames allowed for HTTPS download redirects. */
  downloadHosts: string[]
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('SkillHub 返回的数据格式无效')
  return value as Record<string, unknown>
}
function text(value: unknown): string { return typeof value === 'string' ? value : '' }

/** Validate identifiers before constructing upstream paths. */
function skillSlug(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) throw new Error('SkillHub 技能标识无效')
  return value
}

/** Validate a pinned remote version; it need not match SKILL.md's optional version. */
function skillVersion(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9.+_-]{0,127}$/.test(value)) throw new Error('SkillHub 技能版本无效')
  return value
}

async function boundedBody(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(response.status === 429 ? 'SkillHub 请求频繁，请稍后重试' : `SkillHub 请求失败（HTTP ${String(response.status)}）`)
  }
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('SkillHub 响应为空')
  const parts: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const item = await reader.read()
      if (item.done) break
      size += item.value.byteLength
      if (size > limit) throw new Error('SkillHub 响应超过大小限制')
      parts.push(item.value)
    }
  } finally { await reader.cancel() }
  return Buffer.concat(parts, size)
}

/** Normalize a public skill entry; unknown upstream fields are not forwarded. */
function projectSkill(value: unknown) {
  const item = object(value)
  const labels = item.labels === null || item.labels === undefined ? {} : object(item.labels)
  return {
    slug: skillSlug(item.slug), name: text(item.name) || text(item.displayName) || text(item.slug),
    summary: text(item.description_zh) || text(item.summary_zh) || text(item.description) || text(item.summary),
    version: text(item.version), category: text(item.category), author: text(item.ownerName),
    iconUrl: text(item.iconUrl), downloads: typeof item.downloads === 'number' && Number.isSafeInteger(item.downloads) && item.downloads >= 0 ? item.downloads : null,
    requiresApiKey: labels.requires_api_key === 'true', paid: labels.pricing_type === 'paid',
  }
}

/** Executes only the catalog, detail and pinned download operations used by the marketplace. */
export class SkillHubApi {
  private readonly origin: URL
  constructor(private readonly config: ApiConfig) {
    this.origin = new URL(config.baseURL)
    if (this.origin.protocol !== 'https:' || this.origin.username || this.origin.password || this.origin.search || this.origin.hash || this.origin.pathname !== '/') throw new Error('SkillHub 地址必须为无凭据的 HTTPS 地址')
  }

  private async request(path: string, signal?: AbortSignal): Promise<unknown> {
    const combined = AbortSignal.any([AbortSignal.timeout(this.config.timeoutMs), ...(signal === undefined ? [] : [signal])])
    const response = await fetch(new URL(path, this.origin), { signal: combined, redirect: 'error' })
    return JSON.parse(Buffer.from(await boundedBody(response, this.config.maxJsonBytes)).toString('utf8')) as unknown
  }

  /** Read one filtered page. Invalid caller input never reaches the upstream.
   * @param payload - Validated page, keyword, category and sort inputs.
   * @param signal - Optional cancellation signal.
   * @returns Normalized skills with pagination metadata.
   */
  async list(payload: unknown, signal?: AbortSignal): Promise<{
    items: ReturnType<typeof projectSkill>[]
    total: number
    page: number
    pageSize: number
  }> {
    const input = object(payload)
    const page = input.page ?? 1
    if (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1 || page > 10000) throw new Error('页码无效')
    const keyword = text(input.keyword).trim()
    const category = text(input.category)
    const sort = input.sort ?? 'downloads'
    if (keyword.length > 200 || category.length > 100 || (sort !== 'downloads' && sort !== 'updated_at')) throw new Error('SkillHub 查询参数无效')
    const query = new URLSearchParams({ page: String(page), pageSize: '12', keyword, category, sortBy: sort, order: 'desc' })
    const envelope = object(await this.request(`/api/skills?${query}`, signal))
    if (envelope.code !== 0) throw new Error('SkillHub 目录暂时不可用')
    const data = object(envelope.data)
    if (!Array.isArray(data.skills) || typeof data.total !== 'number' || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error('SkillHub 列表格式无效')
    return { items: data.skills.map(projectSkill), total: data.total, page, pageSize: 12 }
  }

  /** Read upstream categories.
   * @param signal - Optional cancellation signal.
   * @returns Category identifiers and display labels.
   */
  async categories(signal?: AbortSignal): Promise<{ items: { key: string; name: string }[] }> {
    const body = object(await this.request('/api/v1/categories', signal))
    if (!Array.isArray(body.items)) throw new Error('SkillHub 分类格式无效')
    return { items: body.items.map((value) => {
      const item = object(value)
      return { key: text(item.key), name: text(item.name) || text(item.nameEn) }
    }).filter(item => item.key && item.name) }
  }

  /** Read the authoritative downloadable version and ownership information.
   * @param payload - Remote skill identifier.
   * @param signal - Optional cancellation signal.
   * @returns Skill details with the current remote version.
   */
  async detail(payload: unknown, signal?: AbortSignal): Promise<ReturnType<typeof projectSkill>> {
    const slug = skillSlug(object(payload).slug)
    const body = object(await this.request(`/api/v1/skills/${encodeURIComponent(slug)}`, signal))
    const skill = projectSkill(body.skill)
    if (skill.slug !== slug) throw new Error('SkillHub 返回了不同的技能')
    return {
      ...skill, version: skillVersion(object(body.latestVersion).version),
      author: text(object(body.owner).displayName) || text(object(body.owner).handle),
    }
  }

  /** Proxy only the public catalog's bounded raster icons from Tencent's image host. */
  async icon(payload: unknown, signal?: AbortSignal): Promise<{ dataUrl: string }> {
    const raw = object(payload).url
    if (typeof raw !== 'string' || raw.length > 2048) throw new Error('SkillHub 图标地址无效')
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.hostname !== 'cloudcache.tencent-cloud.com' || url.username || url.password || url.port || url.hash) throw new Error('SkillHub 图标地址不在允许范围内')
    const combined = AbortSignal.any([AbortSignal.timeout(this.config.timeoutMs), ...(signal === undefined ? [] : [signal])])
    const response = await fetch(url, { signal: combined, redirect: 'error' })
    const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime ?? '')) {
      await response.body?.cancel()
      throw new Error('SkillHub 图标格式无效')
    }
    const bytes = await boundedBody(response, 256 * 1024)
    return { dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` }
  }

  /** Return a bounded archive through the authenticated loopback RPC.
   * @param payload - Remote skill identifier and pinned version.
   * @param signal - Optional cancellation signal.
   * @returns Base64 archive, transport digest and remote identity.
   */
  async download(payload: unknown, signal?: AbortSignal): Promise<{ archive: string; sha256: string; slug: string; version: string }> {
    const input = object(payload)
    const slug = skillSlug(input.slug)
    const version = skillVersion(input.version)
    const detail = await this.detail({ slug }, signal)
    if (detail.paid) throw new Error('此技能需要购买，暂不支持在这里安装')
    const combined = AbortSignal.any([AbortSignal.timeout(this.config.timeoutMs), ...(signal === undefined ? [] : [signal])])
    let url = new URL(`/api/v1/download?${new URLSearchParams({ slug, version })}`, this.origin)
    for (let hop = 0; hop < 5; hop++) {
      if (url.protocol !== 'https:' || url.username || url.password || (url.origin !== this.origin.origin && !this.config.downloadHosts.includes(url.hostname))) throw new Error('SkillHub 下载地址不在允许范围内')
      const response = await fetch(url, { signal: combined, redirect: 'manual' })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (location === null) throw new Error('SkillHub 下载地址缺失')
        url = new URL(location, url)
        continue
      }
      const bytes = await boundedBody(response, this.config.maxArchiveBytes)
      return { archive: Buffer.from(bytes).toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex'), slug, version }
    }
    throw new Error('SkillHub 下载重定向次数过多')
  }
}
