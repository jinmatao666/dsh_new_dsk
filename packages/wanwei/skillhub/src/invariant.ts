/** Package invariant companion. @module @deepseek-ai/dsh-wanwei-skillhub/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-wanwei-skillhub'
/** Cordis companion name. */
export const name = 'wanwei-skillhub-invariant'
/** Required invariant registry. */
export const inject = ['invariants']
/** No runtime invariant: RPC lifetime is owned by the connection registry; archive installation is owned by the product shell. */
const install: InvariantInstaller = () => {}
/** Reserve package ownership in the invariant registry. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
