/** Package invariant companion. @module @deepseek-ai/dsh-client-ui-oneapi-auth/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-oneapi-auth'
/** Cordis companion name. */
export const name = 'client-ui-oneapi-auth-invariant'
/** Required invariant registry. */
export const inject = ['invariants']
/** No runtime invariant: credentials, settings, and RPC ownership are enforced by their provider registries. */
const install: InvariantInstaller = () => {}
/** Reserve package ownership in the invariant registry. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
