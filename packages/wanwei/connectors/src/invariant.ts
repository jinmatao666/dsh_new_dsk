/** Invariant ownership for @deepseek-ai/dsh-wanwei-connectors. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-wanwei-connectors'
/** Cordis companion plugin name. */
export const name = 'connectors-invariant'
/** Registry required to reserve package ownership. */
export const inject = ['invariants']
/** No runtime invariant: connectors owns reversible Client presentation plus Host CLI/iLink RPC; remote providers own network truth. */
const install: InvariantInstaller = () => {}
/**
 * Reserve package ownership until the companion is disposed.
 * @param ctx - Context containing the invariant registry.
 * @returns Registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
