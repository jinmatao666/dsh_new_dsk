/** Host language policy, contributed through the official prompt-section registry. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { Config } from './config.ts'

export { Config } from './config.ts'
/** Cordis plugin id. */
export const name = 'wanwei-chinese'
/** Official registry required by the language policy. */
export const inject = ['systemPrompt']

/**
 * Add one independently disposable language section without replacing any persona.
 * @param ctx - host plugin context.
 * @param config - validated language policy.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'wanwei:conversation-language', order: -50, text: config.instruction,
  }), 'wanwei-chinese: language policy')
}
