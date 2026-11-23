/** Invariant ownership for @deepseek-ai/dsh-wanwei-portals. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { analysisPrompt } from './analysis.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-wanwei-portals'
/** Cordis companion plugin name. */
export const name = 'portals-invariant'
/** Registry required to reserve package ownership. */
export const inject = ['invariants']
/** Analysis request headers cannot grant tools to article content. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('session/event', (_session, event) => {
    if (event.type !== 'request/header' || event.data.header.system !== analysisPrompt) return
    if (event.data.header.tools?.length) fail('forum analysis exposed tools to article content')
  }, { global: true })
}
/**
 * Reserve package ownership until the companion is disposed.
 * @param ctx - Context containing the invariant registry.
 * @returns Registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
