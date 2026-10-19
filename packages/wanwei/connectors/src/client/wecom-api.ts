/**
 * Client adapter over `/wanwei-wecom` for wecom-cli auth + skill enablement.
 */
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { rpcValue } from './dingtalk-api.ts'
import type { WeComApi, WeComStatus } from './WeComPanel.tsx'
import { productText } from './locales/product.ts'

/**
 * Parse Host wecom-cli status payload.
 * @param value - raw RPC success value.
 * @returns typed status.
 */
export function parseWeComStatus(value: unknown): WeComStatus {
  if (typeof value !== 'object' || value === null) throw new Error(productText('状态加载失败'))
  const record = value as Record<string, unknown>
  if (typeof record.cliInstalled !== 'boolean' || typeof record.authed !== 'boolean'
    || typeof record.skillInstalled !== 'boolean') {
    throw new Error(productText('状态加载失败'))
  }
  return {
    cliInstalled: record.cliInstalled,
    cliVersion: typeof record.cliVersion === 'string' ? record.cliVersion : null,
    authed: record.authed,
    skillInstalled: record.skillInstalled,
    hint: typeof record.hint === 'string' ? record.hint : null,
  }
}

/**
 * Bind Connection RPC to the WeCom panel API.
 * @param connection - authenticated Client connection.
 * @returns status / login / installSkill / disconnect face.
 */
export function createWeComApi(connection: ConnectionHandle): WeComApi {
  const call = async (endpoint: string): Promise<WeComStatus> =>
    parseWeComStatus(rpcValue(await connection.rpc.call('/wanwei-wecom', endpoint, {})))
  return {
    status: () => call('status'),
    login: () => call('login'),
    installSkill: () => call('installSkill'),
    disconnect: () => call('disconnect'),
  }
}
