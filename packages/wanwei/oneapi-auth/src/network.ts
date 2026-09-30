import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-skill'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { internalLink, type NetworkState } from './network-contract.ts'

export interface NetworkPolicy {
  getSnapshot(): NetworkState
  setMode(mode: unknown): Promise<NetworkState>
}
declare module '@deepseek-ai/cordis' {
  interface Context { wanweiNetworkPolicy: NetworkPolicy }
}
/** Persist only the environment choice; model/login URLs remain administrator-owned. */
export function installNetworkPolicy(ctx: Context, baseURL: string): NetworkPolicy {
  const scope = ctx.settings.register(settingsNamespace('wanwei-network'), z.object({
    mode: z.union(['internet', 'intranet'] as const).default('internet'),
  }))
  const policy: NetworkPolicy = {
    getSnapshot: () => ({ mode: scope.get().mode, internalOrigins: [new URL(baseURL).origin] }),
    async setMode(mode) {
      if (mode !== 'internet' && mode !== 'intranet') throw new Error('网络环境无效')
      await scope.update({ mode })
      return policy.getSnapshot()
    },
  }
  ctx.provide('wanweiNetworkPolicy', policy)
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
        if (exec.name === 'web_search' || (exec.name === 'web_fetch'
          && (typeof args.url !== 'string' || !internalLink(args.url, policy.getSnapshot().internalOrigins)))) {
          return { kind: 'deny' as const, reason: '纯内网环境不可用' }
        }
      }
      return next()
    })
  })
  return policy
}
