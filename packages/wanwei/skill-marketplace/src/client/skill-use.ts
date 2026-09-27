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
 */
export function startSkillUse(
  sessions: { clear(): void },
  input: { setStagedDraft(text: string): void },
  slug: string,
  displayName: string,
): void {
  rememberSkillDisplayNames([{ slug, displayName }])
  input.setStagedDraft(`/${slug}`)
  sessions.clear()
}
