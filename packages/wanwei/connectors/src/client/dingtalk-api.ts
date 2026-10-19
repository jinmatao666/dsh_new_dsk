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
  }
}

/**
 * Bind Connection RPC to the DingTalk panel API.
 * @param connection - authenticated Client connection.
 * @returns status / login / installSkill / disconnect face.
 */
export function createDingTalkApi(connection: ConnectionHandle): DingTalkApi {
  const call = async (endpoint: string): Promise<DingTalkStatus> =>
    parseDingTalkStatus(rpcValue(await connection.rpc.call('/wanwei-dingtalk', endpoint, {})))
  return {
    status: () => call('status'),
    login: () => call('login'),
    installSkill: () => call('installSkill'),
    disconnect: () => call('disconnect'),
  }
}
