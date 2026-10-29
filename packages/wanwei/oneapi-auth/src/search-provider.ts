/** Administrator-governed OneAPI web search for the Wanwei desktop profile. */
import { WebError } from '@deepseek-ai/dsh-web'
import type { Context } from '@deepseek-ai/cordis'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'

/** Search provider ID selected by the Wanwei desktop bundle. */
export const ONEAPI_BAILIAN_PROVIDER_ID = 'oneapi-bailian'

const CITATION_GUIDANCE = [
  '网页搜索返回的是候选网页，不代表已核实正文。回答前先用 web_fetch 或可用的浏览器工具读取具体原文，逐条核对事实、事件日期和发布日期。',
  '在每条相关事实或结论的正文末尾先用句号、问号或叹号等句末标点结束，再留一个空格并添加“来源：”及可点击的原文链接，格式为 正文。 来源：[网页真实标题](原文URL)。不要将链接直接紧贴正文，也不要用 source、源网站或只有编号的引用代替“来源：”。链接文字使用检索或实际页面返回的原始标题，不得编造标题。没有真实标题时显示可点击的原文 URL，格式为 正文。 来源：[原文URL](原文URL)，不猜测标题。多条信息逐条附上对应来源；同一条有多个来源时用顿号分隔链接。',
  '链接只能来自本次或后续检索、网页读取工具实际返回的 URL；不能猜测或拼接网址，不能用站点首页或无关网页支撑具体消息。',
  '读取失败、正文不支持结论或资料不足时，明确标注未核实或不采用该条，不得声称已验证。没有来源时明确说明未找到可核验的原文网页。',
  '用户要求国内外今日新闻时，首轮并行检索中文和外文关键词。拿到候选后先用 web_fetch 读取具体文章，再按国内、国外和主要主题补齐缺项，不要只换相似关键词反复搜索。',
  '尽量采用不同发布机构的原文并按事件去重，不把同一事件的转载或同一篇汇总拆成多条。来源网站数量不是允许回答的门槛；单站也应读取并报告其中已核实的独立事件。',
  '补搜应针对尚缺的信息，每轮先处理已有候选。连续两轮补搜没有新增有效原文时停止重复搜索，说明查询、站点范围或原文读取的具体异常；不要把链路异常解释为网上没有新闻。',
  '核对日期时区分事件日期、发布日期与抓取日期，旧闻不计为今日新闻。用户要求多少条就尽量核实多少条，未指定数量不要自行限制为三条；不能为凑数量编造。',
].join('')

/** Install product-owned citation guidance independently of untrusted search content.
 * @param ctx - Host context; prompt registration follows its plugin lifecycle.
 */
export function installSearchCitationPolicy(ctx: Context): void {
  ctx.inject(['systemPrompt'], (child) => {
    child.systemPrompt.section({ name: 'wanwei:web-source-citations',
      order: FIRST_PARTY_SECTION_ORDER.DELIVERABLE_FILE_REFERENCES + 130, text: CITATION_GUIDANCE })
  })
}

interface StatusEnvelope { data?: { search_model?: unknown } }
interface CompletionEnvelope {
  search_info?: { search_results?: unknown }
  error?: { code?: unknown; message?: unknown }
}

function searchSources(value: unknown): WebSearchSource[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new WebError('Invalid web search sources', 'WEB_PROVIDER_RESPONSE_INVALID')
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const source = entry as Record<string, unknown>
    if (typeof source.url !== 'string' || !URL.canParse(source.url)) continue
    const url = new URL(source.url)
    if (!['https:', 'http:'].includes(url.protocol) || url.username !== '' || url.password !== '') continue
    if (seen.has(url.href)) continue
    seen.add(url.href)
    const snippet = typeof source.snippet === 'string' ? source.snippet.trim().slice(0, 700) : ''
    const published = source.publishedAt ?? source.published_at
    const publishedAt = typeof published === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(published)
      && Number.isFinite(Date.parse(published)) ? published : undefined
    sources.push({ url: url.href,
      ...(snippet === '' ? {} : { snippet }),
      ...(publishedAt === undefined ? {} : { publishedAt }),
      ...typeof source.title === 'string' && source.title.trim() !== '' ? { title: source.title.trim() } : {},
    })
  }
  return sources
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > 1024 * 1024) {
    throw new WebError('OneAPI search response exceeded 1 MiB', 'WEB_PROVIDER_RESPONSE_INVALID')
  }
  try { return JSON.parse(text) as unknown }
  catch { throw new WebError(`OneAPI search returned invalid JSON (HTTP ${String(response.status)})`, 'WEB_PROVIDER_RESPONSE_INVALID') }
}

/** Routes web search through the administrator's OneAPI search model. */
export class OneApiSearchProvider implements WebSearchProvider {
  readonly id = ONEAPI_BAILIAN_PROVIDER_ID

  constructor(private readonly options: {
    baseURL: string
    resolveToken: () => Promise<string | undefined>
    allowed?: () => boolean
  }) {}

  available(): boolean { return this.options.allowed?.() !== false && URL.canParse(this.options.baseURL) }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (this.options.allowed?.() === false) throw new WebError('纯内网环境不可用', 'WEB_PROVIDER_UNAVAILABLE')
    const token = await this.options.resolveToken()
    if (token === undefined || token === '') throw new WebError('Sign in before using server-managed web search', 'WEB_PROVIDER_UNAVAILABLE')
    const origin = this.options.baseURL.replace(/\/+$/, '')
    const signalInit = signal === undefined ? {} : { signal }
    const statusResponse = await fetch(`${origin}/api/status`, { redirect: 'error', ...signalInit })
    if (!statusResponse.ok) throw new WebError(`Cannot read the web search model configuration (HTTP ${String(statusResponse.status)})`, 'WEB_PROVIDER_REQUEST_FAILED')
    const status = await readJson(statusResponse) as StatusEnvelope
    const model = typeof status.data?.search_model === 'string' ? status.data.search_model.trim() : ''
    if (model === '') throw new WebError('The administrator has not configured a default web search model', 'WEB_PROVIDER_UNAVAILABLE')

    const endpoint = `${origin}/v1/chat/completions`
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-dsh-web-search': '1',
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: '执行联网检索，保留用户查询中的日期、语言和站点条件。返回相关的具体原文页面，优先原始发布者。不要用站点首页替代文章，不编造来源。' },
          { role: 'user', content: request.query },
        ],
      }),
      ...signalInit,
    })
    const result = await readJson(response) as CompletionEnvelope
    if (!response.ok) {
      const rawCode = result.error?.code
      const code = typeof rawCode === 'string' && /^[\w.-]{1,80}$/.test(rawCode) ? `，错误代码：${rawCode}` : ''
      const upstreamMessage = typeof result.error?.message === 'string' ? result.error.message : ''
      const reason = upstreamMessage.includes('url error') ? '模型与搜索接口不匹配。'
        : upstreamMessage.includes('Non-streaming mode does not support Web Search') ? '搜索模型要求使用流式接口。' : ''
      const guidance = response.status === 400 ? '请求被拒绝，请停止重复搜索并告知用户检查后台搜索模型与渠道配置；更换关键词不能解决接口错误。' : ''
      throw new WebError(`网页搜索失败（HTTP ${String(response.status)}${code}）。${reason}${guidance}`, 'WEB_PROVIDER_REQUEST_FAILED')
    }
    const retrieved = searchSources(result.search_info?.search_results)
    // A single positive site term has unambiguous scope; leave compound OR queries intact.
    const sites = [...request.query.matchAll(/(?:^|\s)site:([a-z0-9.-]+)(?=\s|$)/gi)].map(match => (match[1] ?? '').toLowerCase())
    const site = sites.length === 1 && !/\bOR\b/.test(request.query) ? sites[0] : undefined
    const sources = site === undefined ? retrieved : retrieved.filter((source) => {
      const host = new URL(source.url).hostname.toLowerCase()
      return host === site || host.endsWith(`.${site}`)
    })
    if (site !== undefined && retrieved.length > 0 && sources.length === 0) {
      throw new WebError(`上游返回 ${retrieved.length} 个候选，但没有一个符合 site:${site}。站点限定未得到满足，请检查搜索渠道；不能据此认定该网站没有相关新闻。`,
        'WEB_PROVIDER_SCOPE_MISMATCH')
    }
    const websites = new Set(sources.map(source => new URL(source.url).hostname.replace(/^www\./, '')))
    const content = sources.length === 0
      ? '本次搜索未返回可核验的来源链接。上游未提供有效的结构化检索来源，请检查搜索模型、渠道和来源返回链路；这不证明网上没有相关内容。不要编造标题或链接。'
      : `来源分布：${sources.length} 个链接，${websites.size} 个网站（按域名统计，不代表独立发布机构）。`
        + (site === undefined ? '' : `已按 site:${site} 核对来源域名。`)
        + '下一步先用 web_fetch 读取相关具体原文，核对事件和发布日期；摘要仅供筛选，不是正文核验。再针对缺项补搜，避免重复搜索已有结果。'
    return { content, sources, truncated: false }
  }
}
