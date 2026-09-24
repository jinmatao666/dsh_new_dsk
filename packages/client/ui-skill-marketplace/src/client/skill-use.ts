import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Cache marketplace names for slash tokens displayed by the composer. */
export function rememberSkillDisplayNames(entries: readonly { slug: string; displayName: string }[]): void {
  let names: Record<string, string>
  try { names = JSON.parse(localStorage.getItem('dsh.skill-display-names') ?? '{}') as Record<string, string> }
  catch { names = {} }
  for (const { slug, displayName } of entries) {
    if (slug !== '' && displayName !== '') names[slug] = displayName
  }
  localStorage.setItem('dsh.skill-display-names', JSON.stringify(names))
}

/** Open the no-workspace composer with an editable skill token; never submit it. */
export function startSkillUse(
  sessions: Pick<ISessions, 'clear'>,
  conversation: Pick<IConversation, 'input'>,
  slug: string,
  displayName?: string,
): void {
  if (displayName !== undefined) rememberSkillDisplayNames([{ slug, displayName }])
  conversation.input.setPendingDraft(`/${slug}`)
  sessions.clear()
}
