/**
 * Client adapter over `/wanwei-wechat` for WeChat Assistant QR bind + status.
 */
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { rpcValue } from './dingtalk-api.ts'
import type {
  WeChatApi, WeChatLoginPoll, WeChatLoginStart, WeChatStatus,
} from './WeChatPanel.tsx'
import { productText } from './locales/product.ts'

/**
 * Parse Host WeChat status payload.
 * @param value - raw RPC success value.
 * @returns typed status.
 */
export function parseWeChatStatus(value: unknown): WeChatStatus {
  if (typeof value !== 'object' || value === null) throw new Error(productText('状态加载失败'))
  const record = value as Record<string, unknown>
  if (typeof record.authed !== 'boolean' || typeof record.bridgeRunning !== 'boolean') {
    throw new Error(productText('状态加载失败'))
  }
  return {
    authed: record.authed,
    bridgeRunning: record.bridgeRunning,
    hint: typeof record.hint === 'string' ? record.hint : null,
    sessionId: typeof record.sessionId === 'string' && record.sessionId.trim() !== ''
      ? record.sessionId
      : null,
  }
}

function parseLoginStart(value: unknown): WeChatLoginStart {
  if (typeof value !== 'object' || value === null) throw new Error(productText('状态加载失败'))
  const record = value as Record<string, unknown>
  if (typeof record.sessionKey !== 'string' || typeof record.qrcodeUrl !== 'string'
    || typeof record.qrDataUrl !== 'string') {
    throw new Error(productText('状态加载失败'))
  }
  return {
    sessionKey: record.sessionKey,
    qrcodeUrl: record.qrcodeUrl,
    qrDataUrl: record.qrDataUrl,
    status: parseWeChatStatus(record.status),
  }
}

function parseLoginPoll(value: unknown): WeChatLoginPoll {
  if (typeof value !== 'object' || value === null) throw new Error(productText('状态加载失败'))
  const record = value as Record<string, unknown>
  const phase = record.phase
  if (phase !== 'wait' && phase !== 'scaned' && phase !== 'confirmed' && phase !== 'expired'
    && phase !== 'need_verifycode' && phase !== 'error') {
    throw new Error(productText('状态加载失败'))
  }
  return {
    phase,
    status: parseWeChatStatus(record.status),
    message: typeof record.message === 'string' ? record.message : null,
    qrcodeUrl: typeof record.qrcodeUrl === 'string' ? record.qrcodeUrl : null,
    qrDataUrl: typeof record.qrDataUrl === 'string' ? record.qrDataUrl : null,
  }
}

/**
 * Parse Host ensureSession payload.
 * @param value - raw RPC success value.
 * @returns Session identity for Client navigation.
 */
function parseEnsureSession(value: unknown): { sessionId: string } {
  if (typeof value !== 'object' || value === null) throw new Error(productText('状态加载失败'))
  const record = value as Record<string, unknown>
  if (typeof record.sessionId !== 'string' || record.sessionId.trim() === '') {
    throw new Error(productText('状态加载失败'))
  }
  return { sessionId: record.sessionId }
}

/**
 * Bind Connection RPC to the WeChat Assistant panel API.
 * @param connection - authenticated Client connection.
 * @returns status / loginStart / loginPoll / disconnect / ensureSession face.
 */
export function createWeChatApi(connection: ConnectionHandle): WeChatApi {
  return {
    status: async () => parseWeChatStatus(rpcValue(await connection.rpc.call('/wanwei-wechat', 'status', {}))),
    loginStart: async () => parseLoginStart(rpcValue(await connection.rpc.call('/wanwei-wechat', 'loginStart', {}))),
    loginPoll: async (sessionKey, verifyCode) => parseLoginPoll(rpcValue(await connection.rpc.call(
      '/wanwei-wechat',
      'loginPoll',
      { sessionKey, ...(verifyCode === undefined ? {} : { verifyCode }) },
    ))),
    disconnect: async () => parseWeChatStatus(rpcValue(await connection.rpc.call('/wanwei-wechat', 'disconnect', {}))),
    ensureSession: async () => parseEnsureSession(
      rpcValue(await connection.rpc.call('/wanwei-wechat', 'ensureSession', {})),
    ),
  }
}
