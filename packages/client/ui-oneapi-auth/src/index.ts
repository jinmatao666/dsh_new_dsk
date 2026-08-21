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
})

interface LoginPayload { username: string; password: string }
interface OneApiEnvelope<T> { success: boolean; message?: string; data?: T }
interface LoginData { username?: string }
interface TokenData { key?: string }
interface ModelEntry { id?: string }
interface ModelsBody { data?: ModelEntry[] }
interface ManagedProvider {
  displayName: string
  apiKeyEnv: string
  api: string
  baseURL: string
  defaultInput?: Array<'text' | 'image'>
  models: Array<{ id: string }>
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
interface ProviderSettings { providers?: Record<string, ManagedProvider | Record<string, unknown>> }
interface DefaultModelService {
  saveSelection(next: { provider: string; model: string }): Promise<void>
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

/** Services required by the Host half. */
export const inject = ['connection', 'credentials', 'settings', 'agentDefaultModel']

/** Mount loopback-only authentication RPC and managed-provider synchronization. */
export function apply(ctx: Context, config: Config): void {
  const baseURL = normalizedOrigin(config.baseURL)
  const ref = credentialRef(config.credentialRef)
  const usernameRef = credentialRef('DSH_LOGIN_USERNAME')
  const installMarkerRef = credentialRef('DSH_DESKTOP_INSTALL_MARKER')

  const syncProvider = async (models: string[]): Promise<void> => {
    const current = ctx.settings.get(LLM_SETTINGS) as ProviderSettings
    const managed: ManagedProvider = {
      displayName: 'DSH Server',
      apiKeyEnv: config.credentialRef,
      api: 'openai-completions',
      baseURL: `${baseURL}/v1`,
      models: models.map(id => ({ id })),
      // `/v1/models` from OneAPI exposes ids only.  Carry the deployment's
      // explicit image capability into the DSH provider profile so the new
      // attachment/image admission pipeline can route images correctly.
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
    await ctx.settings.replace(LLM_SETTINGS, {
      providers: { ...(current.providers ?? {}), [config.provider]: managed },
    })
    const firstModel = models[0]
    if (firstModel === undefined) throw new Error('服务器没有返回可用模型')
    const model = config.defaultModel !== undefined && models.includes(config.defaultModel)
      ? config.defaultModel
      : firstModel
    const defaultModel = ctx.get('agentDefaultModel') as DefaultModelService | undefined
    if (defaultModel === undefined) throw new Error('默认模型服务不可用')
    await defaultModel.saveSelection({ provider: config.provider, model })
  }

  const clearLocalAuth = async (): Promise<void> => {
    await ctx.credentials.unset(ref)
    const current = ctx.settings.get(LLM_SETTINGS) as ProviderSettings
    const { [config.provider]: _managed, ...providers } = current.providers ?? {}
    await ctx.settings.replace(LLM_SETTINGS, { providers })
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
      const models = await fetchModels(baseURL, resolved.value, signal)
      await syncProvider(models)
      return username === undefined ? { state: 'authenticated', models } : { state: 'authenticated', models, username }
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
      const models = await fetchModels(baseURL, token, signal)
      await ctx.credentials.set(ref, token)
      await ctx.credentials.set(usernameRef, input.username)
      try {
        await syncProvider(models)
      } catch (error) {
        await ctx.credentials.unset(ref)
        throw error
      }
      return { ok: true as const, value: { state: 'authenticated' as const, models, username: input.username } }
    } catch (error) {
      return internal(error instanceof Error ? error.message : String(error))
    }
  }

  const connection = ctx.get('connection') as HostConnectionHandle | undefined
  if (connection === undefined) throw new Error('桌面认证需要 Connection 服务')
  const remove = connection.rpc.handle('/desktop-auth', async (endpoint, payload, signal) => {
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
    return internal(`未知认证操作：${endpoint}`)
  }, { authority: 'loopback' })
  ctx.effect(() => () => { void remove() }, 'ui-oneapi-auth: loopback RPC')
}
