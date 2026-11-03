/** Invariant ownership for @deepseek-ai/dsh-wanwei-portals. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-wanwei-portals'
/** Cordis companion plugin name. */
export const name = 'portals-invariant'
/** Registry required to reserve package ownership. */
export const inject = ['invariants']
/** No runtime invariant: portals owns reversible Client presentation; page URLs remain administrator-owned deployment settings. */
const install: InvariantInstaller = () => {}
/**
 * Reserve package ownership until the companion is disposed.
 * @param ctx - Context containing the invariant registry.
 * @returns Registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
