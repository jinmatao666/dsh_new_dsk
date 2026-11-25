/** Parse the file identities and excerpts recorded in a knowledge retrieval notice.
 * @param text - Model-facing retrieval notice.
 * @returns Retrieved sources, or null for notices without a source list.
 */
export function knowledgeSources(text: string): Array<{ document: string; original?: string; excerpt: string }> | null {
  const start = text.indexOf('\n\n[')
  if (start === -1) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start + 2))
  } catch {
    // Older notices contain prose in place of the JSON array.
    return null
  }
  if (!Array.isArray(parsed)) return null
  return parsed.flatMap((value: unknown) => {
    const row = (typeof value === 'object' && value !== null ? value as Record<string, unknown> : null)
    if (typeof row?.document !== 'string' || typeof row.excerpt !== 'string') return []
    const original = typeof row.original === 'string'
      && /^\/api\/desktop-knowledge-file\?id=[1-9]\d*&documentId=[\w-]{1,64}$/.test(row.original)
      ? row.original
      : undefined
    return [{ document: row.document, excerpt: row.excerpt, ...(original === undefined ? {} : { original }) }]
  })
}
