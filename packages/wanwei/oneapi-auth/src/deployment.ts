import type { NetworkEnvironment } from './network-contract.ts'

/** Public deployment metadata owned by the desktop's configured OneAPI server. */
export interface DeploymentSettings {
  network: NetworkEnvironment
  operator: string
  phone: string
  features: DeploymentFeatures
  plugins: DeploymentPlugins
}

/** Administrator-owned plugin permissions, independent of personal preferences. */
export interface DeploymentPlugins { browserAssistant: boolean }

/** Validate public plugin permissions; omitted fields preserve older server behavior.
 * @param value - Public API plugin settings.
 * @returns Allowlisted plugin permissions.
 */
export function resolveDeploymentPlugins(value: unknown): DeploymentPlugins {
  if (value === undefined) return { browserAssistant: true }
  if (typeof value !== 'object' || value === null
    || typeof (value as Record<string, unknown>).browserAssistant !== 'boolean') throw new Error('后台插件设置无效')
  return { browserAssistant: (value as { browserAssistant: boolean }).browserAssistant }
}

/** Independent entry visibility for each deployment environment. */
export type DeploymentFeatures = Record<NetworkEnvironment, { automations: boolean; connectors: boolean }>

/** Resolve omitted legacy settings and validate explicitly configured flags.
 * @param value - Public API feature settings.
 * @returns Allowlisted visibility flags for both environments.
 */
export function resolveDeploymentFeatures(value: unknown): DeploymentFeatures {
  if (value === undefined) return {
    internet: { automations: true, connectors: true }, intranet: { automations: true, connectors: false },
  }
  if (typeof value !== 'object' || value === null) throw new Error('后台功能设置无效')
  const result = {} as DeploymentFeatures
  for (const mode of ['internet', 'intranet'] as const) {
    const flags: unknown = (value as Record<string, unknown>)[mode]
    if (typeof flags !== 'object' || flags === null) throw new Error('后台功能设置无效')
    const { automations, connectors } = flags as Record<string, unknown>
    if (typeof automations !== 'boolean' || typeof connectors !== 'boolean') throw new Error('后台功能设置无效')
    result[mode] = { automations, connectors }
  }
  return result
}

/** Read and validate public deployment configuration; never changes network mode on failure.
 * @param baseURL - Configured OneAPI service URL.
 * @param signal - Optional cancellation signal.
 * @returns Server-owned network classification, entry visibility and maintenance contact.
 */
export async function fetchDeploymentSettings(baseURL: string, signal?: AbortSignal): Promise<DeploymentSettings> {
  const response = await fetch(`${baseURL}/api/desktop-config`, { signal: signal ?? null, cache: 'no-store', redirect: 'error' })
  if (!response.ok) throw new Error('无法读取后台系统设置，请确认后台已更新并重试')
  const text = await response.text()
  if (text.length > 16_384) throw new Error('后台系统设置响应过大')
  const body: unknown = JSON.parse(text)
  if (typeof body !== 'object' || body === null) throw new Error('后台系统设置响应无效')
  const envelope = body as { success?: unknown; data?: unknown }
  if (envelope.success !== true || typeof envelope.data !== 'object' || envelope.data === null) throw new Error('后台系统设置响应无效')
  const data = envelope.data as Record<string, unknown>
  if ((data.network !== 'internet' && data.network !== 'intranet') ||
    typeof data.operator !== 'string' || data.operator.length > 160 ||
    typeof data.phone !== 'string' || data.phone.length > 80) throw new Error('后台系统设置字段无效')
  return { network: data.network, operator: data.operator, phone: data.phone,
    features: resolveDeploymentFeatures(data.features), plugins: resolveDeploymentPlugins(data.plugins) }
}
