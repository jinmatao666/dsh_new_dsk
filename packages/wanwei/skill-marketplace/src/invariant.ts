/** Invariant ownership for @deepseek-ai/dsh-wanwei-skill-marketplace. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-wanwei-skill-marketplace'
/** Cordis companion plugin name. */
export const name = 'skill-marketplace-invariant'
/** Registry required to reserve package ownership. */
export const inject = ['invariants']
/** No runtime invariant: catalog views are remote projections;
 * installation state belongs to the native skill provider and registration disposal belongs to the client runtime. */
const install: InvariantInstaller = () => {}
/**
 * Reserve package ownership until the companion is disposed.
 * @param ctx - Context containing the invariant registry.
 * @returns Registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
