import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-skill'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { internalLink, type NetworkState } from './network-contract.ts'
import { DEPENDENCY_BLOCKED, INTRANET_DEPENDENCY_GUIDANCE, shellInput, requiresPublicDependencies, dependencyFailure } from './dependency-policy.ts'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'

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
  const scope = ctx.settings.register(settingsNamespace('wanwei-network'), z.object({
    mode: z.union(['internet', 'intranet'] as const).default('internet'),
  }))
  const policy: NetworkPolicy = {
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
  ctx.inject(['skills'], (sctx) => {
    const install = () => sctx.skills.registerFilter((skill) => {
      if (scope.get().mode === 'internet') return true
      const path = skill.resourceBase?.kind === 'directory' ? skill.resourceBase.path
        : skill.path === undefined ? undefined : dirname(skill.path)
      return path === undefined || !existsSync(join(path, '.wanwei-skillhub.json'))
    })
    let dispose = install()
    sctx.effect(() => scope.watch(() => { dispose(); dispose = install() }))
    sctx.effect(() => () => { dispose() })
  })
  ctx.inject(['tools'], (tctx) => {
    const install = () => tctx.tools.registerAvailability(name => scope.get().mode === 'internet' || name !== 'web_search')
    let dispose = install()
    tctx.effect(() => scope.watch(() => { dispose(); dispose = install() }))
    tctx.effect(() => () => { dispose() })
    tctx.on('tools/pre-execute', async (exec, next) => {
      if (scope.get().mode === 'intranet') {
        const args = typeof exec.arguments === 'object' && exec.arguments !== null ? exec.arguments as Record<string, unknown> : {}
        const command = shellInput(exec.name, args)
        const workdir = typeof args.workdir === 'string' ? args.workdir : exec.agent?.session.header.cwd
        if (command !== undefined && requiresPublicDependencies(command, policy.getSnapshot().internalOrigins, workdir)) {
          return { kind: 'deny' as const, reason: DEPENDENCY_BLOCKED }
        }
        if (exec.name === 'web_search' || (exec.name === 'web_fetch'
          && (typeof args.url !== 'string' || !internalLink(args.url, policy.getSnapshot().internalOrigins)))) {
          return { kind: 'deny' as const, reason: '纯内网环境不可用' }
        }
      }
      return next()
    })
    tctx.on('tools/post-execute', async (exec, result, next) => {
      const decision = await next()
      if (scope.get().mode !== 'intranet' || !['bash', 'terminal_send', 'terminal_read', 'job_output'].includes(exec.name)
        || decision.kind !== 'accept' || decision.value !== undefined) return decision
      const content = decision.content ?? result.content
      const text = content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      if (!dependencyFailure(text)) return decision
      return { ...decision, content: [...content, { type: 'text' as const, text: `\n${DEPENDENCY_BLOCKED}` }] }
    })
  })
  return policy
}
