/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-repeat-tool-reminder`.
 * @module @deepseek-ai/dsh-repeat-tool-reminder/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-repeat-tool-reminder'

/** Cordis companion plugin name. */
export const name = 'repeat-tool-reminder-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: private repeat and failure counters expose no package-owned
 * event or snapshot that an independent companion can compare with tool decisions.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
