/**
 * Personal WeChat Assistant (微信助理): Tencent iLink QR bind + inbound chat bridge.
 * Messages arrive from WeChat and drive a desktop Session; replies return to the
 * WeChat chat window.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import {
  existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { SessionId, type SessionId as WeChatSessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import { resolveProductDshHome } from './dingtalk-dws.ts'

/** Stable sidebar title for the single WeChat Assistant desktop Session. */
const WECHAT_DESKTOP_SESSION_TITLE = '微信助理'

/** Fixed iLink host for QR create / poll (OpenClaw Weixin protocol). */
export const WECHAT_ILINK_QR_BASE = 'https://ilinkai.weixin.qq.com'
/** iLink application id (same public value as @tencent-weixin/openclaw-weixin). */
export const WECHAT_ILINK_APP_ID = 'bot'
/** Channel version encoded into iLink-App-ClientVersion and base_info. */
export const WECHAT_CHANNEL_VERSION = '0.1.0'
/** Default bot_type for get_bot_qrcode. */
export const WECHAT_ILINK_BOT_TYPE = '3'
/** Observability User-Agent analogue sent in base_info. */
export const WECHAT_BOT_AGENT = 'Wanwei/0.1.0'

/** Unary RPC long-poll budget; keep below typical reverse-proxy idle limits. */
const QR_LONG_POLL_TIMEOUT_MS = 20_000
/** Retries when iLink returns `confirmed` before minting bot_token / ilink_bot_id. */
const CONFIRMED_CREDENTIAL_RETRIES = 3
const ACTIVE_LOGIN_TTL_MS = 5 * 60_000
const DEFAULT_GET_UPDATES_TIMEOUT_MS = 35_000
const MESSAGE_TYPE_USER = 1
const MESSAGE_ITEM_TEXT = 1
/** iLink `sendtyping` status values (OpenClaw Weixin `TypingStatus`). */
const TYPING_STATUS_TYPING = 1
const TYPING_STATUS_CANCEL = 2
/** WeChat clears 「对方正在输入…」 shortly after the last typing signal; resend at OpenClaw's cadence. */
const TYPING_KEEPALIVE_MS = 5_000

/** Non-secret WeChat Assistant status for the connectors page. */
export type WeChatStatus = {
  authed: boolean
  bridgeRunning: boolean
  hint: string | null
  /** Fixed desktop Session id when credentials exist and the Session has been ensured. */
  sessionId: string | null
}

/** Login session snapshot returned to the Client (no secrets). */
export type WeChatLoginStart = {
  sessionKey: string
  qrcodeUrl: string
  qrDataUrl: string
  status: WeChatStatus
}

/** One poll tick while the QR modal is open. */
export type WeChatLoginPoll = {
  phase: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'need_verifycode' | 'error'
  status: WeChatStatus
  message: string | null
  qrcodeUrl: string | null
  qrDataUrl: string | null
}

type StoredCredentials = {
  botToken: string
  ilinkBotId: string
  ilinkUserId: string | null
  baseUrl: string
  getUpdatesBuf: string
  connectedAt: number
  replyContext?: { userId: string; token: string }
}

type ActiveLogin = {
  sessionKey: string
  qrcode: string
  qrcodeUrl: string
  qrDataUrl: string
  startedAt: number
  currentApiBaseUrl: string
  pendingVerifyCode?: string
}

type FetchLike = typeof fetch

let statusCache: { at: number; home: string; status: WeChatStatus } | null = null
const activeLogins = new Map<string, ActiveLogin>()
/** One in-flight ensure per product home so「去试试」and the inbound bridge never mint two Sessions. */
const ensureDesktopSessionInflight = new Map<string, Promise<WeChatSessionId>>()
let bridgeAbort: AbortController | null = null
/** Bot token the running bridge polls with; a changed token forces a restart. */
let bridgeToken: string | null = null
let bridgeRunning = false
let fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
let qrDataUrlFactory: ((content: string) => Promise<string>) | null = null

/** 测试时替换 Host HTTP。
 * @param next - 测试请求实现；null 恢复系统 fetch。
 */
export function setWeChatFetchForTests(next: FetchLike | null): void {
  fetchImpl = next ?? globalThis.fetch.bind(globalThis)
}

/** 测试时替换二维码 PNG 编码器。
 * @param next - 测试编码器；null 恢复默认实现。
 */
export function setWeChatQrFactoryForTests(next: ((content: string) => Promise<string>) | null): void {
  qrDataUrlFactory = next
}

/** Drop status cache after login / disconnect. */
export function invalidateWeChatStatusCache(): void {
  statusCache = null
}

/**
 * Credential + sync-buffer directory under the product home.
 * @param dshHome - product DSH home.
 * @returns absolute directory.
 */
export function wechatCredentialDir(dshHome: string): string {
  return join(dshHome, 'wechat-assistant')
}

/**
 * Absolute path of the encrypted-enough local credential file (mode 0600 best-effort).
 * @param dshHome - product DSH home.
 * @returns credentials.json path.
 */
export function wechatCredentialPath(dshHome: string): string {
  return join(wechatCredentialDir(dshHome), 'credentials.json')
}

/**
 * Workspace used for WeChat-driven Sessions.
 * @param dshHome - product DSH home.
 * @returns absolute cwd.
 */
export function wechatWorkspaceDir(dshHome: string): string {
  const override = process.env.DSH_WECHAT_WORKSPACE?.trim()
  if (override) return override
  const dir = join(dshHome, 'wechat-workspace')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Persisted pointer to the single WeChat Assistant desktop Session.
 * @param dshHome - product DSH home.
 * @returns absolute JSON path.
 */
export function wechatDesktopSessionPath(dshHome: string): string {
  return join(wechatCredentialDir(dshHome), 'desktop-session.json')
}

function loadDesktopSessionId(dshHome: string): WeChatSessionId | undefined {
  const path = wechatDesktopSessionPath(dshHome)
  if (!existsSync(path)) return undefined
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { sessionId?: unknown }
    if (typeof raw.sessionId !== 'string' || raw.sessionId.trim() === '') return undefined
    return SessionId(raw.sessionId)
  } catch {
    // Corrupt pointer: create a fresh Session on the next ensure.
    return undefined
  }
}

function saveDesktopSessionId(dshHome: string, sessionId: WeChatSessionId): void {
  mkdirSync(wechatCredentialDir(dshHome), { recursive: true })
  writeFileSync(
    wechatDesktopSessionPath(dshHome),
    `${JSON.stringify({ sessionId }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
}

/**
 * Create or resume the single WeChat Assistant Session under `wechat-workspace`.
 * There is exactly one durable Session for this channel; callers must not ask
 * the user to pick a Workspace. Concurrent callers for the same `dshHome`
 * share one in-flight promise so bridge start and Client「去试试」cannot each
 * create a Session and then diverge.
 * @param ctx - Host context with workspace + sessionController + agents.
 * @param dshHome - product DSH home.
 * @returns live Session id.
 */
export async function ensureWeChatDesktopSession(
  ctx: Context,
  dshHome: string,
): Promise<WeChatSessionId> {
  const pending = ensureDesktopSessionInflight.get(dshHome)
  if (pending !== undefined) return pending
  const run = ensureWeChatDesktopSessionUnlocked(ctx, dshHome).finally(() => {
    if (ensureDesktopSessionInflight.get(dshHome) === run) {
      ensureDesktopSessionInflight.delete(dshHome)
    }
  })
  ensureDesktopSessionInflight.set(dshHome, run)
  return run
}

/** Clear the ensure coalescer (tests only). */
export function resetWeChatDesktopSessionInflightForTests(): void {
  ensureDesktopSessionInflight.clear()
}

async function ensureWeChatDesktopSessionUnlocked(
  ctx: Context,
  dshHome: string,
): Promise<WeChatSessionId> {
  const cwd = wechatWorkspaceDir(dshHome)
  const workspace = await ctx.workspaceRegistry.create(cwd, WECHAT_DESKTOP_SESSION_TITLE)
  // Sidebar "delete" archives a Session but keeps it resumable; an archived
  // 微信助理 Session must be replaced, never revived.
  const archived = new Set(ctx.workspaceRegistry.archivedSessionIds)
  const candidates: WeChatSessionId[] = []
  const saved = loadDesktopSessionId(dshHome)
  if (saved !== undefined && !archived.has(saved)) candidates.push(saved)
  for (const id of workspace.sessionIds) {
    if (!archived.has(id) && !candidates.includes(id)) candidates.push(id)
  }
  for (const sessionId of candidates) {
    const resolved = await ctx.sessionController.resolveAgent(sessionId)
    if ('agent' in resolved) {
      // Reuse the first live Session forever across reconnects; do not create another.
      if (loadDesktopSessionId(dshHome) !== sessionId) saveDesktopSessionId(dshHome, sessionId)
      invalidateWeChatStatusCache()
      return sessionId
    }
    // Only a Session that no longer exists may be replaced; a transient resume
    // failure must not mint a second 微信助理 Session.
    if (resolved.error.code !== 'session-not-found') {
      throw new Error(resolved.error.message || '无法打开微信助理会话')
    }
  }
  const created = await ctx.sessionController.create({ workspaceId: workspace.id })
  saveDesktopSessionId(dshHome, created.sessionId)
  await ctx.sessionController.rename({
    sessionId: created.sessionId,
    title: WECHAT_DESKTOP_SESSION_TITLE,
  }).catch(() => {
    // Title is UX-only; the Session remains usable without it.
  })
  invalidateWeChatStatusCache()
  return created.sessionId
}

function clientVersionUint(): number {
  const parts = WECHAT_CHANNEL_VERSION.split('.').map(part => Number.parseInt(part, 10) || 0)
  const major = parts[0] ?? 0
  const minor = parts[1] ?? 0
  const patch = parts[2] ?? 0
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff)
}

function randomWechatUin(): string {
  return Buffer.from(String(randomBytes(4).readUInt32BE(0)), 'utf8').toString('base64')
}

function commonHeaders(): Record<string, string> {
  return {
    'iLink-App-Id': WECHAT_ILINK_APP_ID,
    'iLink-App-ClientVersion': String(clientVersionUint()),
  }
}

function postHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
    ...commonHeaders(),
  }
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`
  return headers
}

function baseInfo(): { channel_version: string; bot_agent: string } {
  return { channel_version: WECHAT_CHANNEL_VERSION, bot_agent: WECHAT_BOT_AGENT }
}

async function httpGet(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: commonHeaders(),
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`WeChat iLink GET ${response.status}: ${text.slice(0, 200)}`)
    return text
  } finally {
    clearTimeout(timer)
  }
}

async function httpPost(
  url: string,
  body: unknown,
  opts: { token?: string; timeoutMs: number; signal?: AbortSignal },
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs)
  const onAbort = () => controller.abort()
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: postHeaders(opts.token),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`WeChat iLink POST ${response.status}: ${text.slice(0, 200)}`)
    return text
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

async function encodeQrDataUrl(content: string): Promise<string> {
  if (qrDataUrlFactory) return qrDataUrlFactory(content)
  const qrcode = await import('qrcode')
  return qrcode.toDataURL(content, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 280,
    color: { dark: '#000000', light: '#ffffff' },
  })
}

/**
 * Load stored credentials when present and well-formed.
 * @param dshHome - product DSH home.
 * @returns credentials or null.
 */
export function loadWeChatCredentials(dshHome: string): StoredCredentials | null {
  const path = wechatCredentialPath(dshHome)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    if (typeof raw.botToken !== 'string' || raw.botToken.trim() === '') return null
    if (typeof raw.ilinkBotId !== 'string' || raw.ilinkBotId.trim() === '') return null
    if (typeof raw.baseUrl !== 'string' || raw.baseUrl.trim() === '') return null
    return {
      botToken: raw.botToken,
      ilinkBotId: raw.ilinkBotId,
      ilinkUserId: typeof raw.ilinkUserId === 'string' ? raw.ilinkUserId : null,
      baseUrl: raw.baseUrl.replace(/\/+$/, ''),
      getUpdatesBuf: typeof raw.getUpdatesBuf === 'string' ? raw.getUpdatesBuf : '',
      connectedAt: typeof raw.connectedAt === 'number' ? raw.connectedAt : Date.now(),
      ...(typeof raw.replyContext === 'object' && raw.replyContext !== null
        && typeof (raw.replyContext as Record<string, unknown>).userId === 'string'
        && typeof (raw.replyContext as Record<string, unknown>).token === 'string'
        ? { replyContext: raw.replyContext as { userId: string; token: string } } : {}),
    }
  } catch {
    return null
  }
}

function saveCredentials(dshHome: string, credentials: StoredCredentials): void {
  const dir = wechatCredentialDir(dshHome)
  mkdirSync(dir, { recursive: true })
  writeFileSync(wechatCredentialPath(dshHome), `${JSON.stringify(credentials, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

function clearCredentials(dshHome: string): void {
  // Keep `desktop-session.json` so reconnect reuses the same 微信助理 Session.
  const path = wechatCredentialPath(dshHome)
  if (existsSync(path)) rmSync(path, { force: true })
}

/**
 * Build non-secret status for the connectors page.
 * @param dshHome - product DSH home.
 * @param options.fresh - bypass short cache.
 * @returns status snapshot.
 */
export function buildWeChatStatus(
  dshHome: string,
  options: { fresh?: boolean } = {},
): WeChatStatus {
  if (!options.fresh && statusCache !== null
    && statusCache.home === dshHome
    && Date.now() - statusCache.at < 45_000) {
    return { ...statusCache.status, bridgeRunning }
  }
  const credentials = loadWeChatCredentials(dshHome)
  const sessionId = credentials === null ? null : (loadDesktopSessionId(dshHome) ?? null)
  const status: WeChatStatus = credentials === null
    ? {
      authed: false,
      bridgeRunning: false,
      hint: '点击「连接」，用微信扫码绑定远程通道。',
      sessionId: null,
    }
    : {
      authed: true,
      bridgeRunning,
      hint: bridgeRunning
        ? null
        : '已授权；远程通道正在启动，可用微信给助理发指令。',
      sessionId,
    }
  statusCache = { at: Date.now(), home: dshHome, status }
  return { ...status, bridgeRunning }
}

/**
 * Start a QR login session and return an in-app QR image.
 * @param dshHome - product DSH home.
 * @returns session key + QR assets + status.
 */
function localTokenList(dshHome: string): string[] {
  const existing = loadWeChatCredentials(dshHome)
  return existing === null ? [] : [existing.botToken]
}

/** 创建微信助理二维码登录流程，凭据在确认登录后另行持久化。
 * @param dshHome - 当前产品的数据目录，用于读取已有微信凭据。
 * @returns 登录会话标识及可供 Client 展示的二维码信息。
 */
export async function startWeChatLogin(dshHome: string): Promise<WeChatLoginStart> {
  const raw = await httpPost(
    `${WECHAT_ILINK_QR_BASE}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(WECHAT_ILINK_BOT_TYPE)}`,
    { local_token_list: localTokenList(dshHome) },
    { timeoutMs: 15_000 },
  )
  const parsed = JSON.parse(raw) as { qrcode?: string; qrcode_img_content?: string }
  if (typeof parsed.qrcode !== 'string' || parsed.qrcode === ''
    || typeof parsed.qrcode_img_content !== 'string' || parsed.qrcode_img_content === '') {
    throw new Error('微信未返回可用二维码，请稍后重试')
  }
  const sessionKey = randomUUID()
  const qrDataUrl = await encodeQrDataUrl(parsed.qrcode_img_content)
  activeLogins.set(sessionKey, {
    sessionKey,
    qrcode: parsed.qrcode,
    qrcodeUrl: parsed.qrcode_img_content,
    qrDataUrl,
    startedAt: Date.now(),
    currentApiBaseUrl: WECHAT_ILINK_QR_BASE,
  })
  invalidateWeChatStatusCache()
  return {
    sessionKey,
    qrcodeUrl: parsed.qrcode_img_content,
    qrDataUrl,
    status: buildWeChatStatus(dshHome, { fresh: true }),
  }
}

async function refreshLoginQr(login: ActiveLogin, dshHome: string): Promise<void> {
  const raw = await httpPost(
    `${WECHAT_ILINK_QR_BASE}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(WECHAT_ILINK_BOT_TYPE)}`,
    { local_token_list: localTokenList(dshHome) },
    { timeoutMs: 15_000 },
  )
  const parsed = JSON.parse(raw) as { qrcode?: string; qrcode_img_content?: string }
  if (typeof parsed.qrcode !== 'string' || typeof parsed.qrcode_img_content !== 'string') {
    throw new Error('刷新二维码失败')
  }
  login.qrcode = parsed.qrcode
  login.qrcodeUrl = parsed.qrcode_img_content
  login.qrDataUrl = await encodeQrDataUrl(parsed.qrcode_img_content)
  login.startedAt = Date.now()
  delete login.pendingVerifyCode
}

/**
 * Poll one QR login session; persists credentials on confirmed.
 * @param dshHome - product DSH home.
 * @param sessionKey - key from startWeChatLogin.
 * @param verifyCode - optional pairing digits from the phone UI.
 * @param startBridge - called after credentials land (Host wiring).
 * @returns poll snapshot for the Client modal.
 */
export async function pollWeChatLogin(
  dshHome: string,
  sessionKey: string,
  verifyCode: string | undefined,
  startBridge: () => void,
): Promise<WeChatLoginPoll> {
  const login = activeLogins.get(sessionKey)
  if (login === undefined) {
    // A prior poll may have persisted credentials while the Client never saw `confirmed`
    // (hung unary RPC). Treat an already-authed Host as success so the QR modal can close.
    const status = buildWeChatStatus(dshHome, { fresh: true })
    if (status.authed) {
      startBridge()
      return {
        phase: 'confirmed',
        status,
        message: '微信助理已连接',
        qrcodeUrl: null,
        qrDataUrl: null,
      }
    }
    return {
      phase: 'error',
      status,
      message: '当前没有进行中的登录，请重新点「连接」。',
      qrcodeUrl: null,
      qrDataUrl: null,
    }
  }
  if (Date.now() - login.startedAt > ACTIVE_LOGIN_TTL_MS) {
    activeLogins.delete(sessionKey)
    return {
      phase: 'expired',
      status: buildWeChatStatus(dshHome, { fresh: true }),
      message: '二维码已过期，请重新连接。',
      qrcodeUrl: null,
      qrDataUrl: null,
    }
  }
  if (verifyCode?.trim()) login.pendingVerifyCode = verifyCode.trim()

  let endpoint = `${login.currentApiBaseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(login.qrcode)}`
  if (login.pendingVerifyCode) {
    endpoint += `&verify_code=${encodeURIComponent(login.pendingVerifyCode)}`
  }

  let statusBody: {
    status?: string
    bot_token?: string
    ilink_bot_id?: string
    baseurl?: string
    ilink_user_id?: string
    redirect_host?: string
  }
  try {
    statusBody = JSON.parse(await httpGet(endpoint, QR_LONG_POLL_TIMEOUT_MS)) as typeof statusBody
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        phase: 'wait',
        status: buildWeChatStatus(dshHome),
        message: null,
        qrcodeUrl: login.qrcodeUrl,
        qrDataUrl: login.qrDataUrl,
      }
    }
    return {
      phase: 'wait',
      status: buildWeChatStatus(dshHome),
      message: null,
      qrcodeUrl: login.qrcodeUrl,
      qrDataUrl: login.qrDataUrl,
    }
  }

  const phase = statusBody.status ?? 'wait'
  if (phase === 'scaned_but_redirect' && statusBody.redirect_host) {
    login.currentApiBaseUrl = `https://${statusBody.redirect_host}`
    return {
      phase: 'scaned',
      status: buildWeChatStatus(dshHome),
      message: '已扫码，正在验证…',
      qrcodeUrl: login.qrcodeUrl,
      qrDataUrl: login.qrDataUrl,
    }
  }
  if (phase === 'need_verifycode') {
    return {
      phase: 'need_verifycode',
      status: buildWeChatStatus(dshHome),
      message: login.pendingVerifyCode
        ? '数字不匹配，请重新输入手机微信显示的配对码。'
        : '请输入手机微信显示的配对码以继续。',
      qrcodeUrl: login.qrcodeUrl,
      qrDataUrl: login.qrDataUrl,
    }
  }
  if (phase === 'expired' || phase === 'verify_code_blocked') {
    try {
      await refreshLoginQr(login, dshHome)
      return {
        phase: 'wait',
        status: buildWeChatStatus(dshHome),
        message: '二维码已更新，请重新扫描。',
        qrcodeUrl: login.qrcodeUrl,
        qrDataUrl: login.qrDataUrl,
      }
    } catch (error) {
      activeLogins.delete(sessionKey)
      return {
        phase: 'expired',
        status: buildWeChatStatus(dshHome, { fresh: true }),
        message: error instanceof Error ? error.message : '二维码已失效',
        qrcodeUrl: null,
        qrDataUrl: null,
      }
    }
  }
  if (phase === 'binded_redirect') {
    activeLogins.delete(sessionKey)
    const existing = loadWeChatCredentials(dshHome)
    if (existing !== null) {
      startBridge()
      invalidateWeChatStatusCache()
      return {
        phase: 'confirmed',
        status: buildWeChatStatus(dshHome, { fresh: true }),
        message: '此微信已连接过本机，无需重复绑定。',
        qrcodeUrl: null,
        qrDataUrl: null,
      }
    }
    return {
      phase: 'error',
      status: buildWeChatStatus(dshHome, { fresh: true }),
      message: '此微信已绑定过，但本机凭据缺失。请在微信侧解绑后重试。',
      qrcodeUrl: null,
      qrDataUrl: null,
    }
  }
  if (phase === 'confirmed') {
    let body = statusBody
    for (let attempt = 0; attempt < CONFIRMED_CREDENTIAL_RETRIES; attempt += 1) {
      if (typeof body.bot_token === 'string' && body.bot_token !== ''
        && typeof body.ilink_bot_id === 'string' && body.ilink_bot_id !== '') {
        break
      }
      // iLink can report confirmed a beat before minting credentials; re-poll the same QR.
      await new Promise(resolve => setTimeout(resolve, 1_000))
      try {
        let retryEndpoint = `${login.currentApiBaseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(login.qrcode)}`
        if (login.pendingVerifyCode) {
          retryEndpoint += `&verify_code=${encodeURIComponent(login.pendingVerifyCode)}`
        }
        body = JSON.parse(await httpGet(retryEndpoint, QR_LONG_POLL_TIMEOUT_MS)) as typeof statusBody
      } catch {
        // Keep the last body; the loop either recovers credentials or fails below.
      }
    }
    if (typeof body.bot_token !== 'string' || body.bot_token === ''
      || typeof body.ilink_bot_id !== 'string' || body.ilink_bot_id === '') {
      activeLogins.delete(sessionKey)
      return {
        phase: 'error',
        status: buildWeChatStatus(dshHome, { fresh: true }),
        message: '登录失败：服务器未返回凭据。',
        qrcodeUrl: null,
        qrDataUrl: null,
      }
    }
    saveCredentials(dshHome, {
      botToken: body.bot_token,
      ilinkBotId: body.ilink_bot_id,
      ilinkUserId: typeof body.ilink_user_id === 'string' ? body.ilink_user_id : null,
      baseUrl: (body.baseurl?.trim() || WECHAT_ILINK_QR_BASE).replace(/\/+$/, ''),
      getUpdatesBuf: '',
      connectedAt: Date.now(),
    })
    activeLogins.delete(sessionKey)
    invalidateWeChatStatusCache()
    startBridge()
    return {
      phase: 'confirmed',
      status: buildWeChatStatus(dshHome, { fresh: true }),
      message: '微信助理已连接',
      qrcodeUrl: null,
      qrDataUrl: null,
    }
  }
  if (phase === 'scaned') {
    return {
      phase: 'scaned',
      status: buildWeChatStatus(dshHome),
      message: '已扫码，请在手机上确认授权…',
      qrcodeUrl: login.qrcodeUrl,
      qrDataUrl: login.qrDataUrl,
    }
  }
  return {
    phase: 'wait',
    status: buildWeChatStatus(dshHome),
    message: null,
    qrcodeUrl: login.qrcodeUrl,
    qrDataUrl: login.qrDataUrl,
  }
}

/**
 * Clear credentials and stop the inbound bridge.
 * @param dshHome - product DSH home.
 * @returns updated status.
 */
export function disconnectWeChat(dshHome: string): WeChatStatus {
  stopWeChatBridge()
  clearCredentials(dshHome)
  invalidateWeChatStatusCache()
  return buildWeChatStatus(dshHome, { fresh: true })
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

async function notifyLifecycle(
  credentials: StoredCredentials,
  kind: 'start' | 'stop',
  signal?: AbortSignal,
): Promise<void> {
  const endpoint = kind === 'start' ? 'ilink/bot/msg/notifystart' : 'ilink/bot/msg/notifystop'
  try {
    await httpPost(
      `${ensureTrailingSlash(credentials.baseUrl)}${endpoint}`,
      { base_info: baseInfo() },
      {
        token: credentials.botToken,
        timeoutMs: 10_000,
        ...(signal === undefined ? {} : { signal }),
      },
    )
  } catch {
    // Lifecycle notify is best-effort; getupdates still proceeds.
  }
}

/** Send only to the bound user's latest inbound conversation; never an arbitrary contact.
 * @param home - Product credential directory owner.
 * @param text - Explicitly requested notification text.
 * @returns Resolves after iLink accepts the request; expired contexts reject upstream.
 */
export async function sendWeChatNotification(home: string, text: string): Promise<void> {
  const credentials = loadWeChatCredentials(home)
  const context = credentials?.replyContext
  if (!credentials || !context || (credentials.ilinkUserId !== null && context.userId !== credentials.ilinkUserId)) {
    throw new Error('请先绑定微信，并从微信向助理发送一条消息以建立回复会话')
  }
  await sendTextReply(credentials, context.userId, text, context.token)
}

async function sendTextReply(
  credentials: StoredCredentials,
  toUserId: string,
  text: string,
  contextToken: string | undefined,
): Promise<void> {
  await httpPost(
    `${ensureTrailingSlash(credentials.baseUrl)}ilink/bot/sendmessage`,
    {
      base_info: baseInfo(),
      msg: {
        from_user_id: '',
        to_user_id: toUserId,
        client_id: `wanwei-wechat-${randomUUID()}`,
        message_type: 2,
        message_state: 2,
        item_list: text === '' ? undefined : [{ type: MESSAGE_ITEM_TEXT, text_item: { text } }],
        context_token: contextToken,
      },
    },
    { token: credentials.botToken, timeoutMs: 15_000 },
  )
}

async function fetchTypingTicket(
  credentials: StoredCredentials,
  userId: string,
  contextToken: string | undefined,
): Promise<string> {
  const raw = await httpPost(
    `${ensureTrailingSlash(credentials.baseUrl)}ilink/bot/getconfig`,
    { ilink_user_id: userId, context_token: contextToken, base_info: baseInfo() },
    { token: credentials.botToken, timeoutMs: 10_000 },
  )
  const parsed = JSON.parse(raw) as { ret?: number; errmsg?: string; typing_ticket?: string }
  if (parsed.ret !== 0 || typeof parsed.typing_ticket !== 'string' || parsed.typing_ticket === '') {
    throw new Error(`getconfig ret=${parsed.ret} ${parsed.errmsg ?? ''}`)
  }
  return parsed.typing_ticket
}

async function sendTyping(
  credentials: StoredCredentials,
  userId: string,
  ticket: string,
  status: typeof TYPING_STATUS_TYPING | typeof TYPING_STATUS_CANCEL,
): Promise<void> {
  const raw = await httpPost(
    `${ensureTrailingSlash(credentials.baseUrl)}ilink/bot/sendtyping`,
    { ilink_user_id: userId, typing_ticket: ticket, status, base_info: baseInfo() },
    { token: credentials.botToken, timeoutMs: 10_000 },
  )
  const parsed = JSON.parse(raw) as { ret?: number; errmsg?: string }
  if (parsed.ret !== undefined && parsed.ret !== 0) {
    throw new Error(`sendtyping ret=${parsed.ret} ${parsed.errmsg ?? ''}`)
  }
}

/**
 * Show 「对方正在输入…」 in the user's WeChat chat until the returned stop resolves.
 * Typing is best-effort: ticket or send failures are logged and never delay the task.
 * @param ctx - Host context for warnings.
 * @param credentials - bridge credentials.
 * @param userId - bound WeChat user receiving the indicator.
 * @param contextToken - inbound message context token for `getconfig`.
 * @param tickets - per-bridge typing ticket cache keyed by user id; failed tickets are evicted.
 * @returns stop function that ends keepalive and sends the cancel status in the background.
 */
function startTypingIndicator(
  ctx: Context,
  credentials: StoredCredentials,
  userId: string,
  contextToken: string | undefined,
  tickets: Map<string, string>,
): () => void {
  let stopped = false
  let keepalive: ReturnType<typeof setInterval> | undefined
  const send = (ticket: string, status: typeof TYPING_STATUS_TYPING | typeof TYPING_STATUS_CANCEL) =>
    sendTyping(credentials, userId, ticket, status).catch((error: unknown) => {
      clearInterval(keepalive)
      // A late failure from an earlier message must not evict a newer ticket.
      if (tickets.get(userId) === ticket) tickets.delete(userId)
      ctx.logger.warn(`微信输入状态发送失败：${error instanceof Error ? error.message : String(error)}`)
    })
  const cached = tickets.get(userId)
  const ready: Promise<string | null> = (cached === undefined
    ? fetchTypingTicket(credentials, userId, contextToken).then((ticket) => {
      tickets.set(userId, ticket)
      return ticket
    })
    : Promise.resolve(cached)
  ).then((ticket) => {
    if (stopped) return ticket
    void send(ticket, TYPING_STATUS_TYPING)
    keepalive = setInterval(() => { void send(ticket, TYPING_STATUS_TYPING) }, TYPING_KEEPALIVE_MS)
    return ticket
  }, (error: unknown) => {
    ctx.logger.warn(`微信输入状态不可用：${error instanceof Error ? error.message : String(error)}`)
    return null
  })
  return () => {
    stopped = true
    clearInterval(keepalive)
    void ready.then((ticket) => {
      if (ticket !== null) void send(ticket, TYPING_STATUS_CANCEL)
    })
  }
}

function extractUserText(message: {
  item_list?: Array<{ type?: number; text_item?: { text?: string }; voice_item?: { text?: string } }>
}): string {
  const parts: string[] = []
  for (const item of message.item_list ?? []) {
    if (item.type === MESSAGE_ITEM_TEXT && item.text_item?.text) parts.push(item.text_item.text)
    else if (item.voice_item?.text) parts.push(item.voice_item.text)
  }
  return parts.join('\n').trim()
}

function extractAssistantText(agent: Agent): string {
  const events = agent.session.events
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined || event.type !== 'assistant/message') continue
    const blocks = event.data.message.content
    const text = blocks
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim()
    if (text !== '') return text
  }
  return '任务已完成（无文本回复）。'
}

/**
 * Stop the long-poll bridge if running.
 */
export function stopWeChatBridge(): void {
  bridgeAbort?.abort()
  bridgeAbort = null
  bridgeToken = null
  bridgeRunning = false
  invalidateWeChatStatusCache()
}

/**
 * Start (or restart) the inbound WeChat message bridge.
 * @param ctx - Host context with sessionController / agents / workspace.
 * @param dshHome - product DSH home.
 */
export function startWeChatBridge(ctx: Context, dshHome: string): void {
  const credentials = loadWeChatCredentials(dshHome)
  if (credentials === null) return
  // Login polls call this repeatedly; restarting would abort an in-flight phone task.
  if (bridgeAbort !== null && bridgeToken === credentials.botToken) return
  stopWeChatBridge()
  const abort = new AbortController()
  bridgeAbort = abort
  bridgeToken = credentials.botToken
  bridgeRunning = true
  invalidateWeChatStatusCache()
  // Materialize the fixed desktop Session as soon as the channel is live so
  // the Client can open「微信助理」without a Workspace picker.
  void ensureWeChatDesktopSession(ctx, dshHome).catch((error) => {
    ctx.logger.warn(`微信助理会话准备失败：${error instanceof Error ? error.message : String(error)}`)
  })
  void runBridgeLoop(ctx, dshHome, abort.signal).catch((error) => {
    ctx.logger.warn(`微信助理远程通道已停止：${error instanceof Error ? error.message : String(error)}`)
  }).finally(() => {
    if (bridgeAbort === abort) {
      bridgeRunning = false
      bridgeAbort = null
      bridgeToken = null
      invalidateWeChatStatusCache()
    }
  })
}

async function runBridgeLoop(ctx: Context, dshHome: string, signal: AbortSignal): Promise<void> {
  let credentials = loadWeChatCredentials(dshHome)
  if (credentials === null) return
  let active: StoredCredentials = credentials
  const typingTickets = new Map<string, string>()
  await notifyLifecycle(credentials, 'start', signal)
  try {
    while (!signal.aborted) {
      credentials = loadWeChatCredentials(dshHome)
      if (credentials === null) return
      active = credentials
      let response: {
        ret?: number
        errcode?: number
        errmsg?: string
        msgs?: Array<{
          message_type?: number
          from_user_id?: string
          context_token?: string
          item_list?: Array<{ type?: number; text_item?: { text?: string }; voice_item?: { text?: string } }>
        }>
        get_updates_buf?: string
        longpolling_timeout_ms?: number
      }
      try {
        const raw = await httpPost(
          `${ensureTrailingSlash(credentials.baseUrl)}ilink/bot/getupdates`,
          {
            get_updates_buf: credentials.getUpdatesBuf,
            base_info: baseInfo(),
          },
          {
            token: credentials.botToken,
            timeoutMs: credentials.getUpdatesBuf === ''
              ? 15_000
              : DEFAULT_GET_UPDATES_TIMEOUT_MS,
            signal,
          },
        )
        response = JSON.parse(raw) as typeof response
      } catch (error) {
        if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) return
        await new Promise(resolve => setTimeout(resolve, 2_000))
        continue
      }
      if (typeof response.get_updates_buf === 'string') {
        credentials = { ...credentials, getUpdatesBuf: response.get_updates_buf }
        saveCredentials(dshHome, credentials)
      }
      if (response.errcode !== undefined && response.errcode !== 0) {
        ctx.logger.warn(`微信 getupdates errcode=${response.errcode} ${response.errmsg ?? ''}`)
        await new Promise(resolve => setTimeout(resolve, 2_000))
        continue
      }
      for (const message of response.msgs ?? []) {
        if (signal.aborted) return
        if (message.message_type !== MESSAGE_TYPE_USER) continue
        const from = message.from_user_id?.trim()
        if (!from) continue
        if (credentials.ilinkUserId !== null && from !== credentials.ilinkUserId) continue
        if (message.context_token) {
          credentials = { ...credentials, replyContext: { userId: from, token: message.context_token } }
          saveCredentials(dshHome, credentials)
        }
        const text = extractUserText(message)
        if (text === '') {
          await sendTextReply(credentials, from, '暂只支持文字指令，请用文字描述要在电脑上完成的任务。', message.context_token)
            .catch((error: unknown) => {
              ctx.logger.warn(`微信回复失败：${error instanceof Error ? error.message : String(error)}`)
            })
          continue
        }
        const stopTyping = startTypingIndicator(ctx, credentials, from, message.context_token, typingTickets)
        let reply: string
        try {
          reply = await runDesktopTask(ctx, dshHome, text, signal)
        } catch (error) {
          reply = `执行失败：${error instanceof Error ? error.message : String(error)}`
        } finally {
          stopTyping()
        }
        await sendTextReply(credentials, from, reply, message.context_token).catch((error: unknown) => {
          ctx.logger.warn(`微信回复失败：${error instanceof Error ? error.message : String(error)}`)
        })
      }
    }
  } finally {
    // A replaced bridge must not announce offline for the token its successor just started.
    if (bridgeAbort === null) await notifyLifecycle(active, 'stop').catch(() => {})
  }
}

async function runDesktopTask(
  ctx: Context,
  dshHome: string,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted()
  const sessionId = await ensureWeChatDesktopSession(ctx, dshHome)
  signal.throwIfAborted()
  const resolved = await ctx.sessionController.resolveAgent(sessionId)
  if ('error' in resolved) throw new Error(resolved.error.message || '无法打开微信助理会话')
  const agent = resolved.agent
  ctx.permissionPresets.set(agent.session, 'workspace-write')
  signal.throwIfAborted()
  await ctx.sessionController.prompt({
    sessionId,
    requestId: randomUUID() as SessionRequestId,
    mode: 'queue',
    content: [{ type: 'text', text: prompt }],
    clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }, signal)
  await agent.whenIdle()
  await ctx.sessions.flush(agent.session)
  const end = agent.session.events.findLast(event => event.type === 'turn/end')
  if (end?.type === 'turn/end' && end.data.reason.kind === 'error') {
    throw new Error(end.data.reason.error.message)
  }
  if (end?.type === 'turn/end' && end.data.reason.kind !== 'completed') {
    throw new Error(`任务未完成：${end.data.reason.kind}`)
  }
  // Keep the fixed 微信助理 Session alive so the desktop transcript stays open.
  return extractAssistantText(agent)
}

/**
 * Register `/wanwei-wechat` RPC and keep the bridge alive while credentials exist.
 * @param ctx - Host context.
 * @returns disposer.
 */
export function registerWeChatIlinkRpc(ctx: Context): () => void {
  const connection = ctx.get('connection') as HostConnectionHandle
  const dshHome = () => {
    try {
      return resolveProductDshHome()
    } catch {
      const fallback = join(homedir(), '.wanwei-wechat')
      mkdirSync(fallback, { recursive: true })
      return fallback
    }
  }

  const ensureBridge = () => {
    if (loadWeChatCredentials(dshHome()) !== null) startWeChatBridge(ctx, dshHome())
  }
  ensureBridge()

  return ctx.effect(() => {
    const disposeRpc = connection.rpc.handle('/wanwei-wechat', async (endpoint, payload) => {
      try {
        const home = dshHome()
        if (endpoint === 'status') {
          // Revive a bridge whose loop exited on an unexpected error.
          ensureBridge()
          return { ok: true as const, value: buildWeChatStatus(home) }
        }
        if (endpoint === 'loginStart') {
          return { ok: true as const, value: await startWeChatLogin(home) }
        }
        if (endpoint === 'loginPoll') {
          const record = payload !== null && typeof payload === 'object'
            ? payload as Record<string, unknown>
            : {}
          const sessionKey = typeof record.sessionKey === 'string' ? record.sessionKey : ''
          if (sessionKey === '') throw new Error('缺少 sessionKey')
          const verifyCode = typeof record.verifyCode === 'string' ? record.verifyCode : undefined
          return {
            ok: true as const,
            value: await pollWeChatLogin(home, sessionKey, verifyCode, ensureBridge),
          }
        }
        if (endpoint === 'disconnect') {
          return { ok: true as const, value: disconnectWeChat(home) }
        }
        if (endpoint === 'ensureSession') {
          const sessionId = await ensureWeChatDesktopSession(ctx, home)
          return {
            ok: true as const,
            value: { sessionId, status: buildWeChatStatus(home, { fresh: true }) },
          }
        }
        throw new Error('未知微信助理操作')
      } catch (error) {
        return {
          ok: false as const,
          error: {
            code: 'internal',
            message: error instanceof Error ? error.message : String(error),
            details: {},
          },
        }
      }
    })
    return () => {
      stopWeChatBridge()
      disposeRpc()
    }
  }, 'wanwei-connectors: wechat assistant RPC')
}
