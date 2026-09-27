/** Invariant ownership for @deepseek-ai/dsh-wanwei-vision. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-wanwei-vision'
/** Cordis companion plugin name. */
export const name = 'vision-invariant'
/** Registry required to reserve package ownership. */
export const inject = ['invariants']
/** No runtime invariant: image recognition returns a request-local result;
 * credentials and filesystem ownership remain with their providers. */
const install: InvariantInstaller = () => {}
/**
 * Reserve package ownership until the companion is disposed.
 * @param ctx - Context containing the invariant registry.
 * @returns Registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
