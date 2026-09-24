import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Open the no-workspace composer with an editable skill token; never submit it. */
export function startSkillUse(
  sessions: Pick<ISessions, 'clear'>,
  conversation: Pick<IConversation, 'input'>,
  slug: string,
): void {
  conversation.input.setPendingDraft(`/${slug}`)
  sessions.clear()
}
