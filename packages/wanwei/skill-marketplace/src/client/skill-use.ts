import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Keep friendly skill names for the Wanwei draft prefix.
 * @param entries - Skill slug and display-name pairs.
 */
export function rememberSkillDisplayNames(entries: readonly { slug: string; displayName: string }[]): void {
  let names: Record<string, string>
  try { names = JSON.parse(localStorage.getItem('dsh.skill-display-names') ?? '{}') as Record<string, string> }
  catch { names = {} }
  for (const { slug, displayName } of entries) {
    if (slug !== '' && displayName !== '') names[slug] = displayName
  }
  localStorage.setItem('dsh.skill-display-names', JSON.stringify(names))
}

/**
 * Resolve the friendly name of a skill mentioned by its slash token.
 * @param slug - Slash-command skill identifier.
 * @returns Stored display name, if known.
 */
export function skillDisplayName(slug: string): string | undefined {
  try {
    const names = JSON.parse(localStorage.getItem('dsh.skill-display-names') ?? '{}') as Record<string, string>
    return names[slug]
  } catch { return undefined }
}

/**
 * Open a fresh conversation with the installed skill token staged for editing.
 * @param sessions - Generic Session navigation control.
 * @param input - Generic pre-Session draft control.
 * @param slug - Installed skill identifier.
 * @param displayName - Friendly skill name shown in the draft prefix.
 * @param prepareSession - Optional first-send preparation; never called while staging.
 */
export function startSkillUse(
  sessions: { clear(): void },
  input: { setStagedDraft(text: string, prepareSession?: () => Promise<SessionId>): void },
  slug: string,
  displayName: string,
  prepareSession?: () => Promise<SessionId>,
): void {
  rememberSkillDisplayNames([{ slug, displayName }])
  if (prepareSession === undefined) input.setStagedDraft(`/${slug}`)
  else input.setStagedDraft(`/${slug}`, prepareSession)
  sessions.clear()
}

/**
 * Prepare a normal Workspace Session lazily; retain allocated paths across retryable registration failures.
 * @param workspaces - Normal persisted Workspace creation API.
 * @param sessions - Normal Session creation API.
 * @param allocate - Desktop directory allocator receiving local year/month/day/hour/minute digits.
 * @returns First-send preparation, with one successful Session retained across repeated calls.
 */
export function skillSessionPreparation(
  workspaces: Pick<IWorkspaces, 'create'>,
  sessions: Pick<ISessions, 'create'>,
  allocate: (name: string) => Promise<string>,
): () => Promise<SessionId> {
  let prepared: Promise<SessionId> | undefined
  let automaticPath: string | undefined
  return () => {
    prepared ??= (async () => {
      const now = new Date()
      const name = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes()]
        .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0')).join('')
      automaticPath ??= await allocate(name)
      const workspace = await workspaces.create({ path: automaticPath })
      return sessions.create({ workspaceId: workspace.workspaceId })
    })().catch((error: unknown) => { prepared = undefined; throw error })
    return prepared
  }
}
