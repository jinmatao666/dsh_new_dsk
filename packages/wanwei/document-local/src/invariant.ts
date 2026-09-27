/** Invariant ownership for @deepseek-ai/dsh-wanwei-document-local. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-wanwei-document-local'
/** Cordis companion plugin name. */
export const name = 'document-local-invariant'
/** Registry required to reserve package ownership. */
export const inject = ['invariants']
/** No runtime invariant: document conversion returns request-local tool results;
 * filesystem and tool providers own durable state and execution lifetimes. */
const install: InvariantInstaller = () => {}
/**
 * Reserve package ownership until the companion is disposed.
 * @param ctx - Context containing the invariant registry.
 * @returns Registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
