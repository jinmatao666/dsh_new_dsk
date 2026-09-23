import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/** Wait for a new blank conversation after clearing the current workspace selection. */
export function startSkillUse(
  sessions: Pick<ISessions, 'clear' | 'list'>,
  slug: string,
  invoke: (sessionId: SessionId, slug: string) => void,
): () => void {
  sessions.clear()
  let active = true
  const unsubscribe = sessions.list.subscribe(() => {
    const { current, byId } = sessions.list.getSnapshot()
    if (!active || current === undefined) return
    active = false
    unsubscribe()
    if (byId[current]?.blank) invoke(current, slug)
  })
  return () => { active = false; unsubscribe() }
}
