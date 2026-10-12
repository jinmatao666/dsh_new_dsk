/** Invariant ownership for @deepseek-ai/dsh-wanwei-automations. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-wanwei-automations'
/** Cordis companion plugin name. */
export const name = 'automations-invariant'
/** Registry required to reserve package ownership. */
export const inject = ['invariants']
/** Durable task validation is enforced at storage and RPC writes; Agent invariants remain provider-owned. */
const install: InvariantInstaller = () => {}
/**
 * Reserve package ownership until the companion is disposed.
 * @param ctx - Context containing the invariant registry.
 * @returns Registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
