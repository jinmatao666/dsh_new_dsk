import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-tools'
import { internalLink, type NetworkState } from './network-contract.ts'
import { DEPENDENCY_FEEDBACK, INTRANET_DEPENDENCY_GUIDANCE, dependencyFailure } from './dependency-policy.ts'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'
import { fetchDeploymentSettings, type DeploymentPlugins, type DeploymentSettings } from './deployment.ts'
import { ResourceRouting } from './resource-routing.ts'
import type { PipMirrorPolicy } from './pip-mirrors.ts'

/** Host-owned durable network mode and administrator-provided internal origins. */
export interface NetworkPolicy {
  /** Read the current committed mode and internal origins.
   * @returns Current deployment network state.
   */
  getSnapshot(): NetworkState
  /** Persist a validated environment selection.
   * @param mode - Requested internet or intranet mode, validated before persistence.
   * @returns Committed deployment network state.
   */
  setMode(mode: unknown): Promise<NetworkState>
  /** Read a server-confirmed plugin permission; denied before the first successful refresh.
   * @param plugin - Product plugin identifier.
   * @returns Whether the administrator allows the plugin.
   */
  pluginAllowed(plugin: keyof DeploymentPlugins): boolean
  /** Commit validated server permissions without modifying personal settings.
   * @param plugins - Permissions from the configured deployment server.
   */
  setPlugins(plugins: DeploymentPlugins): void
  /** Apply a validated deployment, including shell resource routing.
   * @param settings - Server-owned configuration.
   * @returns Completion of persisted network mode and route selection.
   */
  setDeployment(settings: DeploymentSettings): Promise<void>
}
declare module '@deepseek-ai/cordis' {
  interface Context { wanweiNetworkPolicy: NetworkPolicy }
}
/** Persist the last server-confirmed environment; model/login URLs remain administrator-owned.
 * @param ctx - Plugin scope owning policy registrations and disposal.
 * @param baseURL - Administrator-owned platform URL defining the internal origin.
 * @param resolveToken - Host-owned credential lookup for the authenticated resource tunnel.
 * @param pipMirrors - Product-owned ordered Python indexes and per-attempt time budget.
 * @returns Installed network policy.
 */
export function installNetworkPolicy(ctx: Context, baseURL: string,
  resolveToken?: () => Promise<string | undefined>, pipMirrors?: PipMirrorPolicy): NetworkPolicy {
  let plugins: DeploymentPlugins = { browserAssistant: false }
  const resources = new ResourceRouting(baseURL, undefined, resolveToken, pipMirrors)
  ctx.effect(() => () => resources.dispose())
  let refreshPrompt = () => {}
  let confirmedAt = 0
  let directInternet: boolean | undefined
  let internetCatalogPolicy: 'hide' | 'disable' = 'disable'
  let resourceRelay = false
  let refreshing: Promise<void> | undefined
  const scope = ctx.settings.register(settingsNamespace('wanwei-network'), z.object({
    mode: z.union(['internet', 'intranet'] as const).default('internet'),
  }))
  const policy: NetworkPolicy = {
    async setDeployment(settings) {
      await policy.setMode(settings.network)
      policy.setPlugins(settings.plugins)
      resources.configure(settings.network, settings.resources)
      resourceRelay = settings.resources?.source === 'proxy'
      directInternet = await resources.directAvailable()
      internetCatalogPolicy = settings.internetCatalogPolicy ?? 'disable'
      confirmedAt = Date.now()
      refreshPrompt()
    },
    pluginAllowed: plugin => plugins[plugin],
    setPlugins: (value) => { plugins = value },
    getSnapshot: () => ({ mode: scope.get().mode, internalOrigins: [new URL(baseURL).origin],
      internetCatalogPolicy,
      ...(directInternet === undefined ? {} : { directInternet }) }),
    async setMode(mode) {
      if (mode !== 'internet' && mode !== 'intranet') throw new Error('网络环境无效')
      if (scope.get().mode !== mode) { directInternet = undefined; await scope.update({ mode }) }
      confirmedAt = Date.now()
      return policy.getSnapshot()
    },
  }
  ctx.provide('wanweiNetworkPolicy', policy)
  ctx.inject(['systemPrompt'], (pctx) => {
    const install = () => scope.get().mode === 'intranet' ? pctx.systemPrompt.section({
      name: 'wanwei:intranet-dependencies',
      order: FIRST_PARTY_SECTION_ORDER.DELIVERABLE_FILE_REFERENCES + 110,
      text: resources.guidance() ?? INTRANET_DEPENDENCY_GUIDANCE,
    }) : () => {}
    let dispose = install()
    refreshPrompt = () => { dispose(); dispose = install() }
    pctx.effect(() => scope.watch(() => { dispose(); dispose = install() }))
    pctx.effect(() => () => { dispose() })
  })
  ctx.inject(['tools'], (tctx) => {
    const install = () => tctx.tools.registerAvailability(name => scope.get().mode === 'internet' || name !== 'web_search')
    let dispose = install()
    tctx.effect(() => scope.watch(() => { void dispose(); dispose = install() }))
    tctx.effect(() => async () => { await dispose() })
    tctx.on('tools/pre-execute', async (exec, next) => {
      if (['bash', 'pwsh', 'terminal_open', 'terminal_send'].includes(exec.name)) {
        try {
          if (Date.now() - confirmedAt >= 60_000) {
            refreshing ??= fetchDeploymentSettings(baseURL, AbortSignal.timeout(5000)).then(settings => policy.setDeployment(settings))
            try { await refreshing } finally { refreshing = undefined }
          }
          await resources.prepare()
        } catch {
          return { kind: 'deny' as const, reason: '无法确认后台资源配置，请恢复后台连接后重试；未启动此命令。' }
        }
      }
      if (scope.get().mode === 'intranet') {
        const args = typeof exec.arguments === 'object' && exec.arguments !== null ? exec.arguments as Record<string, unknown> : {}
        if (exec.name === 'web_search' || (exec.name === 'web_fetch'
          && (typeof args.url !== 'string' || !internalLink(args.url, policy.getSnapshot().internalOrigins)))) {
          return { kind: 'deny' as const, reason: exec.name === 'web_fetch' && resourceRelay
            ? '指定网站资源请使用 Shell：python -m wanwei_resource "网址"；下载追加 --output "工作区内文件路径"。该命令复用后台选择的资源路由，不需要安装依赖。'
            : '纯内网环境不可用' }
        }
      }
      return next()
    })
    tctx.on('tools/post-execute', async (exec, result, next) => {
      const decision = await next()
      if (scope.get().mode !== 'intranet' || !['bash', 'pwsh', 'terminal_send', 'terminal_read', 'job_output'].includes(exec.name)
        || decision.kind !== 'accept' || decision.value !== undefined) return decision
      const content = decision.content ?? result.content
      const text = content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      const failure = dependencyFailure(text)
      if (failure === undefined) return decision
      return { ...decision, content: [...content, { type: 'text' as const, text: `\n${DEPENDENCY_FEEDBACK[failure]}` }] }
    })
  })
  return policy
}
