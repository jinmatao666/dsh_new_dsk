/**
 * Host half of the desktop OneAPI authentication plugin.
 *
 * Passwords and generated tokens remain on the loopback Host. The browser
 * receives only authentication state and model ids, while the durable token
 * is delegated to the normal DSH credentials provider.
 * @module @deepseek-ai/dsh-client-ui-oneapi-auth
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection/src/rpc.ts'
import type { AuthState } from './contract.ts'

export type { AuthState } from './contract.ts'

const LLM_SETTINGS = settingsNamespace('llm-pi-ai')
const MAX_RESPONSE_BYTES = 1024 * 1024

/** Desktop OneAPI authentication configuration. */
export interface Config {
  /** OneAPI origin, without the OpenAI-compatible `/v1` suffix. */
  baseURL: string
  /** DSH provider route managed by this login plugin. */
  provider: string
  /** Credential reference containing the generated OneAPI token. */
  credentialRef: string
  /** Name assigned to automatically created OneAPI tokens. */
  tokenName: string
  /** Optional preferred default model id. */
  defaultModel?: string
  /**
   * Input modalities advertised for models returned by OneAPI.
   *
   * OneAPI's `/v1/models` response only contains model ids, so the DSH
   * runtime cannot discover vision support from that endpoint.  The newer DSH
   * image pipeline deliberately refuses images for hand-declared models until
   * this capability is declared.  Keep the deployment choice here (rather
   * than making every desktop user edit settings); a text-only upstream must
   * leave `image` out.
   */
  defaultInput?: Array<'text' | 'image'>
  /** Build-specific marker used to require login once after a new install. */
  installId?: string
  /** Skip the login overlay inside the source-only Tauri development shell. */
  developmentBypass?: boolean
}

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  baseURL: z.string().required(),
  provider: z.string().default('dsh-server'),
  credentialRef: z.string().default('DSH_ONEAPI_TOKEN'),
  tokenName: z.string().default('DSH Desktop Auto Token'),
  defaultModel: z.string(),
  defaultInput: z.array(z.union(['text', 'image'] as const)).default(['text']),
  installId: z.string(),
  developmentBypass: z.boolean().default(false),
})

interface LoginPayload { username: string; password: string }
interface OneApiEnvelope<T> { success: boolean; message?: string; data?: T }
interface LoginData { username?: string }
interface TokenData { key?: string }
interface ModelEntry { id?: string }
interface ModelsBody { data?: ModelEntry[] }
interface StatusBody { data?: { default_model?: unknown } }
interface ClientModelDetail {
  id?: unknown
  name?: unknown
  modalities?: { input?: unknown }
}
interface ManagedModel {
  id: string
  name?: string
  input?: Array<'text' | 'image'>
}
interface ManagedProvider {
  displayName: string
  apiKeyEnv: string
  api: string
  baseURL: string
  defaultInput?: Array<'text' | 'image'>
  models: ManagedModel[]
  /** Explicit compatibility for the regional OpenAI-compatible gateway. */
  compat?: {
    supportsStore: boolean
    supportsDeveloperRole: boolean
    supportsReasoningEffort: boolean
    supportsUsageInStreaming: boolean
    maxTokensField: 'max_tokens' | 'max_completion_tokens'
    supportsStrictMode: boolean
    thinkingFormat: 'qwen-chat-template'
    chatTemplateKwargs: { enable_thinking: boolean }
  }
}
interface DefaultModelService {
  saveSelection(next: { provider: string; model: string }): Promise<void>
}
interface QuestionReport {
  question?: unknown
  sessionId?: unknown
  requestId?: unknown
  model?: unknown
  status?: unknown
  error?: unknown
}

interface PersonalSkillUploadFile { path: string; contentBase64: string }
interface PersonalSkillSubmission {
  slug: string
  displayName: string
  category: string
  icon: string
  description: string
  visibility: 'private' | 'public'
  body: string
  files: PersonalSkillUploadFile[]
}

function internal(message: string): { ok: false; error: { code: 'internal'; message: string; details: Record<string, never> } } {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

function normalizedOrigin(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('OneAPI 地址必须使用 http 或 https')
  }
  if (url.username !== '' || url.password !== '') throw new Error('OneAPI 地址不能包含凭据')
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

async function jsonBody<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error('OneAPI 响应过大')
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`OneAPI 返回了无效 JSON（HTTP ${String(response.status)}）`)
  }
}

function sessionCookie(headers: Headers): string | undefined {
  const withCookies = headers as Headers & { getSetCookie?: () => string[] }
  const candidates = typeof withCookies.getSetCookie === 'function'
    ? withCookies.getSetCookie()
    : [headers.get('set-cookie') ?? '']
  for (const raw of candidates) {
    const match = raw.match(/(?:^|[,;]\s*)session=([^;,\s]+)/i)
    if (match !== null && match[1] !== undefined) return `session=${match[1]}`
  }
  return undefined
}

function loginPayload(payload: unknown): LoginPayload {
  if (typeof payload !== 'object' || payload === null) throw new Error('登录参数无效')
  const input = payload as Record<string, unknown>
  if (typeof input.username !== 'string' || input.username.trim() === '') throw new Error('请输入用户名')
  if (typeof input.password !== 'string' || input.password === '') throw new Error('请输入密码')
  if (input.username.length > 256 || input.password.length > 1024) throw new Error('登录参数过长')
  return { username: input.username.trim(), password: input.password }
}

function personalSkillSubmission(payload: unknown): PersonalSkillSubmission {
  if (typeof payload !== 'object' || payload === null) throw new Error('个人技能上传参数无效')
  const input = payload as Record<string, unknown>
  const text = (key: string, max: number): string => {
    const value = input[key]
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`个人技能字段 ${key} 不能为空`)
    if (value.length > max) throw new Error(`个人技能字段 ${key} 过长`)
    return value.trim()
  }
  const visibility = input.visibility
  if (visibility !== 'private' && visibility !== 'public') throw new Error('个人技能可见范围无效')
  if (!Array.isArray(input.files) || input.files.length === 0 || input.files.length > 128) {
    throw new Error('个人技能必须包含 1 至 128 个文件')
  }
  const files = input.files.map((entry): PersonalSkillUploadFile => {
    if (typeof entry !== 'object' || entry === null) throw new Error('个人技能文件信息无效')
    const file = entry as Record<string, unknown>
    if (typeof file.path !== 'string' || file.path === '' || file.path.length > 512) throw new Error('个人技能文件路径无效')
    if (typeof file.contentBase64 !== 'string' || file.contentBase64.length > 24 * 1024 * 1024) throw new Error(`个人技能文件 ${file.path} 内容无效`)
    return { path: file.path, contentBase64: file.contentBase64 }
  })
  const body = typeof input.body === 'string' ? input.body : ''
  if (body.length > 1024 * 1024) throw new Error('SKILL.md 内容过大')
  return {
    slug: text('slug', 128),
    displayName: text('displayName', 128),
    category: text('category', 128),
    icon: text('icon', 512),
    description: typeof input.description === 'string' ? input.description.trim().slice(0, 4_000) : '',
    visibility,
    body,
    files,
  }
}

/** Narrow test seam for protocol-boundary parsing with no service access. */
export const internals = { normalizedOrigin, sessionCookie, loginPayload, personalSkillSubmission }

async function fetchModels(baseURL: string, token: string, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(`${baseURL}/v1/models`, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  })
  if (response.status === 401 || response.status === 403) throw Object.assign(new Error('登录已失效'), { authInvalid: true })
  if (!response.ok) throw new Error(`模型服务暂时不可用（HTTP ${String(response.status)}）`)
  const body = await jsonBody<ModelsBody>(response)
  const models = [...new Set((body.data ?? []).flatMap(entry =>
    typeof entry.id === 'string' && entry.id.trim() !== '' ? [entry.id] : []))]
  if (models.length === 0) throw new Error('服务器没有返回可用模型')
  return models
}

/**
 * Fetch server-governed per-model capabilities.  New OneAPI deployments expose
 * this authenticated endpoint; old deployments retain the `/v1/models`
 * fallback below, so a desktop upgrade does not make a region unavailable.
 */
async function fetchManagedModels(baseURL: string, token: string, fallbackInput: Array<'text' | 'image'>, signal?: AbortSignal): Promise<ManagedModel[]> {
  try {
    const response = await fetch(`${baseURL}/api/user/available_models/detail`, {
      headers: { authorization: `Bearer ${token}` },
      ...(signal === undefined ? {} : { signal }),
    })
    if (response.status === 401 || response.status === 403) throw Object.assign(new Error('登录已失效'), { authInvalid: true })
    if (!response.ok) throw new Error(`模型详情暂时不可用（HTTP ${String(response.status)}）`)
    const body = await jsonBody<OneApiEnvelope<ClientModelDetail[]>>(response)
    if (!body.success) throw new Error(body.message ?? '模型详情暂时不可用')
    const models = (body.data ?? []).flatMap((entry): ManagedModel[] => {
      const id = typeof entry.id === 'string' ? entry.id.trim() : ''
      if (id === '') return []
      const input = Array.isArray(entry.modalities?.input)
        ? [...new Set(entry.modalities.input.filter((value): value is 'text' | 'image' => value === 'text' || value === 'image'))]
        : []
      return [{
        id,
        ...(typeof entry.name === 'string' && entry.name.trim() !== '' ? { name: entry.name.trim() } : {}),
        // A registered server model should always declare text.  Keep the
        // build fallback only for an old/malformed server response.
        input: input.length > 0 ? input : fallbackInput,
      }]
    })
    const unique = [...new Map(models.map(model => [model.id, model])).values()]
    if (unique.length === 0) throw new Error('服务器没有返回可用模型')
    return unique
  } catch (error) {
    if ((error as { authInvalid?: unknown }).authInvalid === true) throw error
    // Compatibility fallback for deployments that have not upgraded their
    // OneAPI image yet.  Those models retain the explicit desktop fallback.
    const models = await fetchModels(baseURL, token, signal)
    return models.map(id => ({ id, input: fallbackInput }))
  }
}

/**
 * The server-owned default is optional. A temporarily unavailable status
 * endpoint must not prevent an already authenticated desktop user from using
 * their assigned models, so callers deliberately fall back to build config.
 */
async function fetchServerDefaultModel(baseURL: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const response = await fetch(`${baseURL}/api/status`, {
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) return undefined
    const body = await jsonBody<StatusBody>(response)
    const model = body.data?.default_model
    return typeof model === 'string' && model.trim() !== '' ? model.trim() : undefined
  } catch {
    return undefined
  }
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text === '' ? undefined : text.slice(0, max)
}

const developmentExperts = [
  { key: 'geology-analysis', name: '地质条件分析专家', subtitle: '地质环境与灾害易发性分析', category: '空间分析', summary: '提交项目地块范围，分析地质环境条件与地质灾害易发性，查看 Excel 明细和 Word 专业报告。', icon: 'gis', tags: '["地质环境","灾害易发性","专业报告"]', scenario: '适用于项目选址、规划前期资料研判及地质灾害易发性分析。', materials: '提供面或多面的 GeoJSON、完整 Shape 文件或 Shape ZIP；坐标系无法从文件识别时需人工确认。' },
  { key: 'third-survey-analysis', name: '三调土地利用现状分析专家', subtitle: '三调地类、面积与权属现状分析', category: '空间分析', summary: '提交项目地块范围，分析三调土地利用现状、主要地类构成及耕地保护相关情况，查看专业报告和明细。', icon: 'survey', tags: '["三调现状","地类构成","耕地保护"]', scenario: '项目选址、用地现状研判、前期资料核验。', materials: 'GeoJSON、完整 Shape 文件或 Shape ZIP；坐标系无法识别时需人工确认。' },
  { key: 'land-use-plan-review', name: '土地利用规划审查专家', subtitle: '规划符合性与用途管制审查', category: '空间分析', summary: '提交项目地块范围，审查项目与规划管控要求的空间关系，识别冲突范围、风险事项和需进一步核实内容。', icon: 'planning', tags: '["规划审查","用途管制","合规风险"]', scenario: '项目选址、规划前置审查、用地合规研判。', materials: 'GeoJSON、完整 Shape 文件或 Shape ZIP；坐标系无法识别时需人工确认。' },
  { key: 'file-conversion-pdf', name: '文件转换与 PDF 工具专家', subtitle: '常用文档、PDF 与图片批量处理', category: '办公工具', summary: '提供 Word 转 PDF、PDF 转图片、PDF 合并拆分、图片转 PDF，以及图片压缩与格式转换能力。', icon: 'writing', tags: '["文件转换","PDF 工具","图片处理"]', scenario: '办公文件转换、PDF 页面整理、图片归档和批量图片优化。', materials: '根据所选工具提供 Word、PDF 或 JPG、JPEG、PNG、WebP 图片文件。' },
  { key: 'document-intelligence', name: '文档智能处理专家', subtitle: '摘要提炼与版本差异分析', category: '办公工具', summary: '读取办公文档，提取摘要、重点、风险、时间节点和待办事项，或比较两份材料的新增、删除及关键变化。', icon: 'writing', tags: '["文档摘要","要点提取","文档对比"]', scenario: '政策文件、项目报告、合同、制度和会议材料的快速阅读及版本变化核对。', materials: '摘要任务提供一份或多份可读取文档；对比任务提供原始版本和新版本各一份。' },
  { key: 'meeting-minutes', name: '会议纪要专家', subtitle: '录音转写与结构化纪要', category: '办公工具', summary: '提交会议录音、已有转写稿和相关文字材料，生成结构清晰的 Word 会议纪要。', icon: 'meeting', tags: '["录音转写","会议纪要","行动事项"]', scenario: '适用于例会、项目沟通、评审会及访谈材料整理。', materials: '最多一个 WAV、M4A 或 MP3 录音，可同时提供多个可读取的文字材料；也支持仅使用文字材料。' },
] as const

/** Services required by the Host half. */
export const inject = ['connection', 'credentials', 'settings', 'agentDefaultModel']

/** Mount loopback-only authentication RPC and managed-provider synchronization. */
export function apply(ctx: Context, config: Config): void {
  if (config.developmentBypass === true && process.env.DSH_DESKTOP_DEVELOPMENT !== '1') {
    throw new Error('桌面开发认证旁路只能由 Tauri debug shell 启用')
  }
  const baseURL = normalizedOrigin(config.baseURL)
  const ref = credentialRef(config.credentialRef)
  const usernameRef = credentialRef('DSH_LOGIN_USERNAME')
  const installMarkerRef = credentialRef('DSH_DESKTOP_INSTALL_MARKER')

  const syncProvider = async (models: ManagedModel[], serverDefaultModel?: string): Promise<void> => {
    const managed: ManagedProvider = {
      displayName: 'Model Server',
      apiKeyEnv: config.credentialRef,
      api: 'openai-completions',
      baseURL: `${baseURL}/v1`,
      models,
      // This only applies to malformed / legacy model-detail responses.  On a
      // current server every model carries its own `input` array above.
      defaultInput: config.defaultInput ?? ['text'],
      // The DSH OneAPI route fronts Qwen-compatible OpenAI endpoints. Keep
      // the wire contract explicit instead of letting pi-ai infer it from a
      // private URL: avoid unsupported reasoning/developer fields and send
      // the model's documented thinking switch.
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        supportsUsageInStreaming: true,
        maxTokensField: 'max_tokens',
        supportsStrictMode: false,
        thinkingFormat: 'qwen-chat-template',
        chatTemplateKwargs: { enable_thinking: false },
      },
    }
    // The desktop distribution is intentionally server-managed: models come
    // exclusively from OneAPI rather than from any legacy local/provider
    // configuration that may have been left by an older installation.
    await ctx.settings.replace(LLM_SETTINGS, {
      providers: { [config.provider]: managed },
    })
    const firstModel = models[0]?.id
    if (firstModel === undefined) throw new Error('服务器没有返回可用模型')
    const configuredDefault = serverDefaultModel ?? config.defaultModel
    const model = configuredDefault !== undefined && models.some(entry => entry.id === configuredDefault)
      ? configuredDefault
      : firstModel
    const defaultModel = ctx.get('agentDefaultModel') as DefaultModelService | undefined
    if (defaultModel === undefined) throw new Error('默认模型服务不可用')
    await defaultModel.saveSelection({ provider: config.provider, model })
  }

  const clearLocalAuth = async (): Promise<void> => {
    await ctx.credentials.unset(ref)
    await ctx.settings.replace(LLM_SETTINGS, { providers: {} })
  }

  const reportQuestion = async (payload: unknown): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: 'internal'; message: string; details: Record<string, never> } }> => {
    try {
      const input = (typeof payload === 'object' && payload !== null ? payload : {}) as QuestionReport
      const token = (await ctx.credentials.resolve(ref))?.value
      const question = boundedText(input.question, 32_000)
      if (token === undefined || question === undefined) return { ok: true, value: { reported: false } }
      const data: Record<string, string> = { question, status: boundedText(input.status, 32) ?? 'submitted' }
      for (const [key, value] of [['session_id', input.sessionId], ['request_id', input.requestId], ['model', input.model], ['error', input.error]] as const) {
        const text = boundedText(value, key === 'error' ? 8_000 : 256)
        if (text !== undefined) data[key] = text
      }
      await fetch(`${baseURL}/api/client-event`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ events: [{ event: 'dsh_question', data, ts: Date.now() }], platform: 'desktop' }),
      })
      return { ok: true, value: { reported: true } }
    } catch {
      // Telemetry must never block a model request or make the desktop unusable.
      return { ok: true, value: { reported: false } }
    }
  }

  const listPublishedSkills = async (signal?: AbortSignal): Promise<unknown> => {
    const response = await fetch(`${baseURL}/api/skill/?page=1&perPage=100`, {
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) throw new Error(`技能目录暂时不可用（HTTP ${String(response.status)}）`)
    return jsonBody<unknown>(response)
  }

  const listPublishedExperts = async (signal?: AbortSignal): Promise<unknown> => {
    const response = await fetch(`${baseURL}/api/expert/`, {
      ...(signal === undefined ? {} : { signal }),
    })
    const result = await jsonBody<OneApiEnvelope<unknown[]>>(response)
    if (!response.ok || result.success !== true) throw new Error(result.message ?? `专家目录暂时不可用（HTTP ${String(response.status)}）`)
    return { items: Array.isArray(result.data) ? result.data : [] }
  }

  const listPublishedSkillCategories = async (signal?: AbortSignal): Promise<unknown> => {
    const response = await fetch(`${baseURL}/api/skill-package/`, {
      ...(signal === undefined ? {} : { signal }),
    })
    const result = await jsonBody<OneApiEnvelope<unknown[]>>(response)
    if (!response.ok || result.success !== true) {
      throw new Error(result.message ?? `技能分类暂时不可用（HTTP ${String(response.status)}）`)
    }
    return { items: Array.isArray(result.data) ? result.data : [] }
  }

  const downloadPublishedSkillBundle = async (payload: unknown, signal?: AbortSignal): Promise<unknown> => {
    const id = typeof (payload as { id?: unknown })?.id === 'number' ? (payload as { id: number }).id : Number.NaN
    if (!Number.isInteger(id) || id < 1) throw new Error('技能标识无效')
    const token = (await ctx.credentials.resolve(ref))?.value
    if (token === undefined) throw new Error('请先登录后再安装技能')
    const response = await fetch(`${baseURL}/api/skill/${String(id)}/bundle`, {
      headers: { authorization: `Bearer ${token}` },
      ...(signal === undefined ? {} : { signal }),
    })
    const result = await jsonBody<OneApiEnvelope<unknown>>(response)
    if (!response.ok || result.success !== true || result.data === undefined) {
      throw new Error(result.message ?? `技能包下载失败（HTTP ${String(response.status)}）`)
    }
    return result.data
  }

  const recordPublishedSkillInstall = async (payload: unknown, signal?: AbortSignal): Promise<unknown> => {
    const id = typeof (payload as { id?: unknown })?.id === 'number' ? (payload as { id: number }).id : Number.NaN
    if (!Number.isInteger(id) || id < 1) throw new Error('技能标识无效')
    const response = await fetch(`${baseURL}/api/skill/${String(id)}/download`, {
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
    const result = await jsonBody<OneApiEnvelope<unknown>>(response)
    if (!response.ok || result.success !== true) throw new Error(result.message ?? `技能安装计数失败（HTTP ${String(response.status)}）`)
    return result.data
  }

  const submitPersonalSkill = async (payload: unknown, signal?: AbortSignal): Promise<unknown> => {
    const input = personalSkillSubmission(payload)
    const token = (await ctx.credentials.resolve(ref))?.value
    if (token === undefined) throw new Error('请先登录后再上传个人技能')
    const response = await fetch(`${baseURL}/api/personal-skill/submit`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: input.slug,
        display_name: input.displayName,
        category: input.category,
        icon: input.icon,
        description: input.description,
        body: input.body,
        assets: JSON.stringify({ schemaVersion: 1, files: input.files }),
        visibility: input.visibility,
        tags: ['个人'],
      }),
      ...(signal === undefined ? {} : { signal }),
    })
    const result = await jsonBody<OneApiEnvelope<unknown>>(response)
    if (!response.ok || result.success !== true) throw new Error(result.message ?? `个人技能上传失败（HTTP ${String(response.status)}）`)
    return result.data
  }

  const listPersonalSkills = async (signal?: AbortSignal): Promise<unknown> => {
    const token = (await ctx.credentials.resolve(ref))?.value
    if (token === undefined) throw new Error('请先登录后再读取个人技能')
    const response = await fetch(`${baseURL}/api/personal-skill/?page=1&perPage=100`, {
      headers: { authorization: `Bearer ${token}` },
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) throw new Error(`个人技能暂时不可用（HTTP ${String(response.status)}）`)
    return jsonBody<unknown>(response)
  }

  // Credentials intentionally survive normal restarts, but a newly built
  // installer carries a new marker and must show the login screen once.
  const installReady = (async (): Promise<void> => {
    const installId = config.installId?.trim()
    if (installId === undefined || installId === '') return
    const marker = await ctx.credentials.resolve(installMarkerRef)
    if (marker?.value !== installId) {
      await clearLocalAuth()
      await ctx.credentials.set(installMarkerRef, installId)
    }
  })()

  const status = async (signal?: AbortSignal): Promise<AuthState> => {
    await installReady
    const resolved = await ctx.credentials.resolve(ref)
    const username = (await ctx.credentials.resolve(usernameRef))?.value
    if (resolved === undefined) return username === undefined ? { state: 'logged-out' } : { state: 'logged-out', username }
    try {
      const [models, serverDefaultModel] = await Promise.all([
        fetchManagedModels(baseURL, resolved.value, config.defaultInput ?? ['text'], signal),
        fetchServerDefaultModel(baseURL, signal),
      ])
      await syncProvider(models, serverDefaultModel)
      const ids = models.map(model => model.id)
      return username === undefined ? { state: 'authenticated', models: ids } : { state: 'authenticated', models: ids, username }
    } catch (error) {
      if ((error as { authInvalid?: unknown }).authInvalid === true) {
        await clearLocalAuth()
        return { state: 'logged-out' }
      }
      return { state: 'offline', message: error instanceof Error ? error.message : String(error) }
    }
  }

  const login = async (payload: unknown, signal: AbortSignal) => {
    try {
      const input = loginPayload(payload)
      const response = await fetch(`${baseURL}/api/user/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal,
      })
      const loginResult = await jsonBody<OneApiEnvelope<LoginData>>(response)
      if (!response.ok || !loginResult.success) return internal(loginResult.message ?? '用户名或密码错误')
      const cookie = sessionCookie(response.headers)
      if (cookie === undefined) return internal('登录成功，但服务器没有返回会话 Cookie')

      const tokenResponse = await fetch(`${baseURL}/api/token/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ name: config.tokenName, remain_quota: 10_000_000_000, unlimited_quota: false }),
        signal,
      })
      const tokenResult = await jsonBody<OneApiEnvelope<TokenData>>(tokenResponse)
      const token = tokenResult.data?.key
      if (!tokenResponse.ok || !tokenResult.success || token === undefined || token === '') {
        return internal(tokenResult.message ?? '无法创建模型访问令牌')
      }
      const [models, serverDefaultModel] = await Promise.all([
        fetchManagedModels(baseURL, token, config.defaultInput ?? ['text'], signal),
        fetchServerDefaultModel(baseURL, signal),
      ])
      await ctx.credentials.set(ref, token)
      await ctx.credentials.set(usernameRef, input.username)
      try {
        await syncProvider(models, serverDefaultModel)
      } catch (error) {
        await ctx.credentials.unset(ref)
        throw error
      }
      return { ok: true as const, value: { state: 'authenticated' as const, models: models.map(model => model.id), username: input.username } }
    } catch (error) {
      return internal(error instanceof Error ? error.message : String(error))
    }
  }

  const connection = ctx.get('connection') as HostConnectionHandle | undefined
  if (connection === undefined) throw new Error('桌面认证需要 Connection 服务')
  const remove = connection.rpc.handle('/desktop-auth', async (endpoint, payload, signal) => {
    if (endpoint === 'expert-list') {
      try {
        return { ok: true as const, value: await listPublishedExperts(signal) }
      } catch (error) {
        if (config.developmentBypass === true) return { ok: true as const, value: { items: developmentExperts } }
        return internal(error instanceof Error ? error.message : String(error))
      }
    }
    if (endpoint === 'skill-list') {
      try {
        return { ok: true as const, value: await listPublishedSkills(signal) }
      } catch (error) {
        return internal(error instanceof Error ? error.message : String(error))
      }
    }
    if (endpoint === 'skill-categories') {
      try {
        return { ok: true as const, value: await listPublishedSkillCategories(signal) }
      } catch (error) {
        return internal(error instanceof Error ? error.message : String(error))
      }
    }
    if (endpoint === 'skill-bundle') {
      try {
        return { ok: true as const, value: await downloadPublishedSkillBundle(payload, signal) }
      } catch (error) {
        return internal(error instanceof Error ? error.message : String(error))
      }
    }
    if (endpoint === 'skill-download') {
      try {
        return { ok: true as const, value: await recordPublishedSkillInstall(payload, signal) }
      } catch (error) {
        return internal(error instanceof Error ? error.message : String(error))
      }
    }
    if (endpoint === 'personal-skill-submit') {
      try {
        return { ok: true as const, value: await submitPersonalSkill(payload, signal) }
      } catch (error) {
        return internal(error instanceof Error ? error.message : String(error))
      }
    }
    if (endpoint === 'personal-skill-list') {
      try {
        return { ok: true as const, value: await listPersonalSkills(signal) }
      } catch (error) {
        return internal(error instanceof Error ? error.message : String(error))
      }
    }
    if (config.developmentBypass === true) {
      if (endpoint === 'report-question') return { ok: true as const, value: { reported: false } }
      if (endpoint === 'status' || endpoint === 'login' || endpoint === 'logout') {
        return { ok: true as const, value: { state: 'authenticated' as const, models: [], username: '本地开发' } }
      }
      return internal(`未知认证操作：${endpoint}`)
    }
    if (endpoint === 'status') {
      try {
        return { ok: true as const, value: await status(signal) }
      } catch (error) {
        return internal(error instanceof Error ? error.message : String(error))
      }
    }
    if (endpoint === 'login') return login(payload, signal)
    if (endpoint === 'logout') {
      try {
        await clearLocalAuth()
        const username = (await ctx.credentials.resolve(usernameRef))?.value
        return { ok: true as const, value: username === undefined ? { state: 'logged-out' } : { state: 'logged-out', username } satisfies AuthState }
      } catch (error) {
        return internal(error instanceof Error ? error.message : String(error))
      }
    }
    if (endpoint === 'report-question') return reportQuestion(payload)
    return internal(`未知认证操作：${endpoint}`)
  }, { authority: 'loopback' })
  ctx.effect(() => () => { void remove() }, 'ui-oneapi-auth: loopback RPC')
}
