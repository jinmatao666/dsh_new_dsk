/**
 * Client adapter over `/wanwei-dingtalk` for DWS personal auth + skill enablement.
 */
import type { ConnectionHandle, RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import type { DingTalkApi, DingTalkStatus } from './DingTalkPanel.tsx'
import { productText } from './locales/product.ts'

/**
 * Unwrap a Connection RPC result or throw the Host error message.
 * @param result - RPC envelope from `connection.rpc.call`.
 * @returns success value.
 */
export function rpcValue(result: RpcResult<unknown>): unknown {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

const TRANSPORT_MESSAGES = new Set([
  'Failed to fetch',
  'NetworkError when attempting to fetch resource.',
  'TypeError: Failed to fetch',
])

/**
 * Whether `error` is the browser dropping a Host request, including the product copy
 * already substituted for that failure.
 * @param error - thrown value from `connection.rpc.call` or a later retry.
 * @returns true when the connectors page should retry rather than treat it as a CLI failure.
 */
export function isConnectorTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return TRANSPORT_MESSAGES.has(message)
    || message === productText('无法连接本机服务以写入技能。请确认桌面端仍在运行后重试；若反复失败请使用完整安装包。')
}

/**
 * Map browser transport failures (literal `Failed to fetch`) to product copy.
 * Host skill-install errors keep their original Chinese message.
 * @param error - thrown value from `connection.rpc.call` or Host unwrap.
 * @returns Error with a user-facing message.
 */
export function connectorRpcError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  // Only the browser's own transport failure. Host messages that mention
  // "Failed to fetch" (for example a GitHub skill download) must stay intact.
  if (TRANSPORT_MESSAGES.has(message)) {
    return new Error(productText('无法连接本机服务以写入技能。请确认桌面端仍在运行后重试；若反复失败请使用完整安装包。'))
  }
  return error instanceof Error ? error : new Error(message)
}

/**
 * Parse Host DWS status payload.
 * @param value - raw RPC success value.
 * @returns typed status.
 */
export function parseDingTalkStatus(value: unknown): DingTalkStatus {
  if (typeof value !== 'object' || value === null) throw new Error(productText('状态加载失败'))
  const record = value as Record<string, unknown>
  if (typeof record.dwsInstalled !== 'boolean' || typeof record.authed !== 'boolean'
    || typeof record.skillInstalled !== 'boolean') {
    throw new Error(productText('状态加载失败'))
  }
  return {
    dwsInstalled: record.dwsInstalled,
    dwsVersion: typeof record.dwsVersion === 'string' ? record.dwsVersion : null,
    authed: record.authed,
    skillInstalled: record.skillInstalled,
    hint: typeof record.hint === 'string' ? record.hint : null,
    authorizing: record.authorizing === true,
    authorizeError: typeof record.authorizeError === 'string' ? record.authorizeError : null,
  }
}

/**
 * Bind Connection RPC to the DingTalk panel API.
 * @param connection - authenticated Client connection.
 * @returns status / login / installSkill / disconnect face.
 */
export function createDingTalkApi(connection: ConnectionHandle): DingTalkApi {
  const call = async (endpoint: string): Promise<DingTalkStatus> => {
    try {
      return parseDingTalkStatus(rpcValue(await connection.rpc.call('/wanwei-dingtalk', endpoint, {})))
    } catch (error) {
      throw connectorRpcError(error)
    }
  }
  return {
    status: () => call('status'),
    login: () => call('login'),
    installSkill: () => call('installSkill'),
    disconnect: () => call('disconnect'),
  }
}
