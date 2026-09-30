/** Invariant ownership for the Chinese language plugin. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Companion plugin id. */
export const name = 'wanwei-chinese-invariant'
/** Invariant registry dependency. */
export const inject = ['invariants']
/** No runtime invariant: prompt logging and locale ownership remain with their registries. */
const install: InvariantInstaller = () => {}
/**
 * Reserve ownership for this plugin's companion.
 * @param ctx - invariant registry context.
 * @returns registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-wanwei-chinese', install))
