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

/** Narrow test seam for protocol-boundary parsing with no service access. */
export const internals = { normalizedOrigin, sessionCookie, loginPayload }

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
    if (endpoint === 'skill-list') {
      try {
        return { ok: true as const, value: await listPublishedSkills(signal) }
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
