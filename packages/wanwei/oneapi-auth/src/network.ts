import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-tools'
import { internalLink, type NetworkState } from './network-contract.ts'
import { DEPENDENCY_FEEDBACK, INTRANET_DEPENDENCY_GUIDANCE, dependencyFailure } from './dependency-policy.ts'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'
import type { DeploymentPlugins } from './deployment.ts'

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
}
declare module '@deepseek-ai/cordis' {
  interface Context { wanweiNetworkPolicy: NetworkPolicy }
}
/** Persist the last server-confirmed environment; model/login URLs remain administrator-owned.
 * @param ctx - Plugin scope owning policy registrations and disposal.
 * @param baseURL - Administrator-owned platform URL defining the internal origin.
 * @returns Installed network policy.
 */
export function installNetworkPolicy(ctx: Context, baseURL: string): NetworkPolicy {
  let plugins: DeploymentPlugins = { browserAssistant: false }
  const scope = ctx.settings.register(settingsNamespace('wanwei-network'), z.object({
    mode: z.union(['internet', 'intranet'] as const).default('internet'),
  }))
  const policy: NetworkPolicy = {
    pluginAllowed: plugin => plugins[plugin],
    setPlugins: (value) => { plugins = value },
    getSnapshot: () => ({ mode: scope.get().mode, internalOrigins: [new URL(baseURL).origin] }),
    async setMode(mode) {
      if (mode !== 'internet' && mode !== 'intranet') throw new Error('网络环境无效')
      if (scope.get().mode !== mode) await scope.update({ mode })
      return policy.getSnapshot()
    },
  }
  ctx.provide('wanweiNetworkPolicy', policy)
  ctx.inject(['systemPrompt'], (pctx) => {
    const install = () => scope.get().mode === 'intranet' ? pctx.systemPrompt.section({
      name: 'wanwei:intranet-dependencies',
      order: FIRST_PARTY_SECTION_ORDER.DELIVERABLE_FILE_REFERENCES + 110,
      text: INTRANET_DEPENDENCY_GUIDANCE,
    }) : () => {}
    let dispose = install()
    pctx.effect(() => scope.watch(() => { dispose(); dispose = install() }))
    pctx.effect(() => () => { dispose() })
  })
  ctx.inject(['tools'], (tctx) => {
    const install = () => tctx.tools.registerAvailability(name => scope.get().mode === 'internet' || name !== 'web_search')
    let dispose = install()
    tctx.effect(() => scope.watch(() => { dispose(); dispose = install() }))
    tctx.effect(() => () => { dispose() })
    tctx.on('tools/pre-execute', async (exec, next) => {
      if (scope.get().mode === 'intranet') {
        const args = typeof exec.arguments === 'object' && exec.arguments !== null ? exec.arguments as Record<string, unknown> : {}
        if (exec.name === 'web_search' || (exec.name === 'web_fetch'
          && (typeof args.url !== 'string' || !internalLink(args.url, policy.getSnapshot().internalOrigins)))) {
          return { kind: 'deny' as const, reason: '纯内网环境不可用' }
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
