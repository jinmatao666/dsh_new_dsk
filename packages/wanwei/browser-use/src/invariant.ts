/** Invariant ownership for the browser compatibility plugin. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'wanwei-browser-use-invariant'
export const inject = ['invariants']
/** No runtime invariant: browser resource ownership is enforced by the official Session runtime. */
const install: InvariantInstaller = () => {}
/** Reserve package ownership; disposal removes registration. @param ctx - invariant registry. @returns disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-wanwei-browser-use', install))
