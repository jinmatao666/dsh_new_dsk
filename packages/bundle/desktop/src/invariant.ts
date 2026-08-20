/** Package invariant companion. @module @deepseek-ai/dsh-desktop/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-desktop'
/** Cordis companion name. */
export const name = 'desktop-bundle-invariant'
/** Required invariant registry. */
export const inject = ['invariants']
/** No runtime invariant: the bundle owns only an immutable patch layer and no live relationship. */
const install: InvariantInstaller = () => {}
/** Reserve bundle ownership in the invariant registry. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
