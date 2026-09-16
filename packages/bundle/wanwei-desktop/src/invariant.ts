/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-wanwei-desktop`.
 * @module @deepseek-ai/dsh-wanwei-desktop/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-wanwei-desktop'

/** Cordis companion plugin name. */
export const name = 'wanwei-desktop-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: this package carries only a static product patch.
// Each feature package owns the mutable relationships its rows activate.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
