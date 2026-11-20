import type { NetworkEnvironment } from './network-contract.ts'
import { resolveResourceSettings, type ResourceSettings } from './resource-settings.ts'

/** Public deployment metadata owned by the desktop's configured OneAPI server. */
export interface DeploymentSettings {
  featureOrder?: readonly string[]
  billing?: BillingPolicy
  internetCatalogPolicy?: 'hide' | 'disable'
  internetSkillPolicy?: 'hide' | 'disable'
  internetExpertPolicy?: 'hide' | 'disable'
  network: NetworkEnvironment
  operator: string
  phone: string
  features: DeploymentFeatures
  featurePages: DeploymentFeaturePages
  plugins: DeploymentPlugins
  resources?: ResourceSettings
}

/** Validate catalog presentation while retaining older deployment records.
 * @param value - Administrator setting from the public deployment response.
 * @returns Hidden or disabled presentation, defaulting to disabled.
 */
export function resolveInternetCatalogPolicy(value: unknown): 'hide' | 'disable' {
  if (value === undefined) return 'disable'
  if (value !== 'hide' && value !== 'disable') throw new Error('后台技能专家联网处理设置无效')
  return value
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
export type DeploymentFeatures = Record<NetworkEnvironment, {
  expertLibrary: boolean
  skillMarketplace: boolean
  automations: boolean
  connectors: boolean
  knowledgeBases: boolean
  landMarket: boolean
  planningLecture: boolean
  policyEncyclopedia: boolean
}>

/** Administrator-configured portal page addresses shown by desktop feature entries. */
export type DeploymentFeaturePageId = 'landMarket' | 'planningLecture' | 'policyEncyclopedia'
export type DeploymentFeaturePages = Record<DeploymentFeaturePageId, { url: string }>

const FEATURE_PAGE_IDS = ['landMarket', 'planningLecture', 'policyEncyclopedia'] as const

/** Resolve omitted legacy settings and validate explicitly configured flags.
 * @param value - Public API feature settings.
 * @returns Allowlisted visibility flags for both environments.
 */
export function resolveDeploymentFeatures(value: unknown): DeploymentFeatures {
  if (value === undefined) return {
    internet: { expertLibrary: true, skillMarketplace: true, automations: true, connectors: true, knowledgeBases: true,
      landMarket: false, planningLecture: false,
      policyEncyclopedia: false },
    intranet: { expertLibrary: true, skillMarketplace: true, automations: true, connectors: false, knowledgeBases: true,
      landMarket: false, planningLecture: false,
      policyEncyclopedia: false },
  }
  if (typeof value !== 'object' || value === null) throw new Error('后台功能设置无效')
  const result = {} as DeploymentFeatures
  for (const mode of ['internet', 'intranet'] as const) {
    const flags: unknown = (value as Record<string, unknown>)[mode]
    if (typeof flags !== 'object' || flags === null) throw new Error('后台功能设置无效')
    const record = flags as Record<string, unknown>
    const { automations, connectors } = record
    const expertLibrary = record.expertLibrary === undefined ? true : record.expertLibrary
    const skillMarketplace = record.skillMarketplace === undefined ? true : record.skillMarketplace
    // 旧后台尚未提供知识库或门户开关；显式 null 或错误类型仍必须拒绝。
    const knowledgeBases = Object.hasOwn(record, 'knowledgeBases') ? record.knowledgeBases : true
    const landMarket = Object.hasOwn(record, 'landMarket') ? record.landMarket : false
    const planningLecture = Object.hasOwn(record, 'planningLecture') ? record.planningLecture : false
    const policyEncyclopedia = Object.hasOwn(record, 'policyEncyclopedia') ? record.policyEncyclopedia : false
    if (typeof expertLibrary !== 'boolean' || typeof skillMarketplace !== 'boolean' || typeof automations !== 'boolean' || typeof connectors !== 'boolean'
      || typeof knowledgeBases !== 'boolean' || typeof landMarket !== 'boolean'
      || typeof planningLecture !== 'boolean' || typeof policyEncyclopedia !== 'boolean') {
      throw new Error('后台功能设置无效')
    }
    result[mode] = { expertLibrary, skillMarketplace, automations, connectors, knowledgeBases,
      landMarket, planningLecture, policyEncyclopedia }
  }
  return result
}

/** Validate one portal page URL from the public deployment response.
 * @param value - Candidate URL string.
 * @returns Trimmed URL, empty when unset.
 */
function resolveFeaturePageUrl(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') throw new Error('后台功能页面地址无效')
  const url = value.trim()
  if (url === '') return ''
  if (url.length > 2048) throw new Error('后台功能页面地址无效')
  let parsed: URL
  try { parsed = new URL(url) }
  catch { throw new Error('后台功能页面地址无效') }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.host) {
    throw new Error('后台功能页面地址无效')
  }
  return url
}

/** Resolve omitted portal pages and validate configured addresses.
 * @param value - Public API feature page settings.
 * @returns Allowlisted portal page addresses.
 */
export function resolveDeploymentFeaturePages(value: unknown): DeploymentFeaturePages {
  if (value === undefined) {
    return { landMarket: { url: '' }, planningLecture: { url: '' }, policyEncyclopedia: { url: '' } }
  }
  if (typeof value !== 'object' || value === null) throw new Error('后台功能页面配置无效')
  const result = { landMarket: { url: '' }, planningLecture: { url: '' }, policyEncyclopedia: { url: '' } }
  for (const id of FEATURE_PAGE_IDS) {
    const entry = (value as Record<string, unknown>)[id]
    if (entry === undefined) continue
    if (typeof entry !== 'object' || entry === null) throw new Error('后台功能页面配置无效')
    result[id] = { url: resolveFeaturePageUrl((entry as Record<string, unknown>).url) }
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
  const resources = resolveResourceSettings(data.resources)
  return { billing: resolveBillingPolicy(data.billing, data.edition), network: data.network, operator: data.operator, phone: data.phone,
    internetCatalogPolicy: resolveInternetCatalogPolicy(data.internetCatalogPolicy),
    internetSkillPolicy: resolveInternetCatalogPolicy(
      data.internetSkillPolicy === undefined ? data.internetCatalogPolicy : data.internetSkillPolicy),
    internetExpertPolicy: resolveInternetCatalogPolicy(
      data.internetExpertPolicy === undefined ? data.internetCatalogPolicy : data.internetExpertPolicy),
    ...(resources === undefined ? {} : { resources }),
    featureOrder: resolveFeatureOrder(data.featureOrder),
    features: resolveDeploymentFeatures(data.features),
    featurePages: resolveDeploymentFeaturePages(data.featurePages),
    plugins: resolveDeploymentPlugins(data.plugins) }
}


/** Administrator-owned visibility and accounting switches. */
export interface BillingPolicy { showCredits: boolean; showMultipliers: boolean; enabled: boolean }
/** Resolve absent legacy flags from the edition and reject malformed explicit flags.
 * @param value - Optional billing object returned by the backend.
 * @param edition - Edition supplying defaults for absent switches.
 * @returns Independent display and accounting permissions.
 */
export function resolveBillingPolicy(value: unknown, edition: unknown = 'operations'): BillingPolicy {
  const base = edition !== 'government'
  if (value === undefined) return { showCredits: base, showMultipliers: base, enabled: base }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('积分开关配置无效')
  const record = value as Record<string, unknown>
  const result = { showCredits: base, showMultipliers: base, enabled: base }
  for (const key of ['showCredits', 'showMultipliers', 'enabled'] as const) {
    const flag = record[key]
    if (flag !== undefined && typeof flag !== 'boolean') throw new Error('积分开关配置无效')
    if (typeof flag === 'boolean') result[key] = flag
  }
  return result
}

/** Default desktop entry order for deployment records without a custom order. */
export const defaultFeatureOrder = ['automations', 'connectors', 'knowledgeBases', 'expertLibrary', 'landMarket', 'skillMarketplace', 'planningLecture', 'policyEncyclopedia'] as const

/** Validate the administrator's complete sidebar ordering.
 * @param value - Public deployment order, or undefined for the default.
 * @returns Validated feature identifiers in display order.
 */
export function resolveFeatureOrder(value: unknown): readonly string[] {
  if (value === undefined) return defaultFeatureOrder
  if (!Array.isArray(value) || value.length !== defaultFeatureOrder.length || new Set(value).size !== value.length
    || value.some(key => !(defaultFeatureOrder as readonly unknown[]).includes(key))) throw new Error('Invalid featureOrder')
  return value as string[]
}
