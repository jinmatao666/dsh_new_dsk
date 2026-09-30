/** Host language policy, contributed through the official prompt-section registry. */
import type { Context } from '@deepseek-ai/cordis'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'
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
    name: 'wanwei:conversation-language',
    // Reassert the communication language after tool guidance, before output schemas.
    // Ordering does not replace personas or bypass complete-persona isolation.
    order: FIRST_PARTY_SECTION_ORDER.DELIVERABLE_FILE_REFERENCES + 100,
    text: config.instruction,
  }), 'wanwei-chinese: language policy')
}
