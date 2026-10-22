/** One RAGFlow chunk box in PDF absolute coordinates (or 0–1 normalized). */
export interface CitationPosition {
  page: number
  left: number
  right: number
  top: number
  bottom: number
}

/** Desktop-locatable source returned with a knowledge answer. */
export interface KnowledgeCitation {
  index: number
  chunk_index: number
  document_id: string
  document_name: string
  page?: number
  quote: string
  chunk_id?: string
  positions?: CitationPosition[]
}

/** RAGFlow ##i$$ and [ID:i] markers; i is the 0-based reference chunk index. */
const MARKER_GLOBAL = /##(\d+)\$\$|\[ID:(\d+)\]/gi

/** Whether a citation can open a document locate target.
 * @param citation - Parsed citation row.
 * @returns True when a document id is present.
 */
export function citationLocatable(citation: KnowledgeCitation): boolean {
  return citation.document_id.trim() !== ''
}

/** Replace answer markers with numbered slots; drop unknown markers.
 * @param answer - Plain-text answer that may include RAGFlow markers.
 * @param citations - Citations from the finished completion.
 * @returns Ordered text and citation segments for rendering.
 */
export function splitAnswerCitations(
  answer: string,
  citations: KnowledgeCitation[],
): Array<{ type: 'text'; text: string } | { type: 'citation'; citation: KnowledgeCitation }> {
  const byChunk = new Map(citations.map(citation => [citation.chunk_index, citation]))
  const parts: Array<{ type: 'text'; text: string } | { type: 'citation'; citation: KnowledgeCitation }> = []
  let cursor = 0
  for (const match of answer.matchAll(MARKER_GLOBAL)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push({ type: 'text', text: answer.slice(cursor, index) })
    const chunkIndex = Number(match[1] ?? match[2])
    const citation = byChunk.get(chunkIndex)
    if (citation !== undefined && citationLocatable(citation)) {
      parts.push({ type: 'citation', citation })
    }
    cursor = index + match[0].length
  }
  if (cursor < answer.length) parts.push({ type: 'text', text: answer.slice(cursor) })
  if (parts.length === 0) return [{ type: 'text', text: answer }]
  return parts
}

/** Parse citation rows from a Host/OneAPI payload.
 * @param raw - Unknown JSON value.
 * @returns Validated citation list.
 */
export function parseCitations(raw: unknown): KnowledgeCitation[] {
  if (!Array.isArray(raw)) return []
  const out: KnowledgeCitation[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    if (!Number.isInteger(row.index) || !Number.isInteger(row.chunk_index) ||
      typeof row.document_id !== 'string' || typeof row.document_name !== 'string' ||
      typeof row.quote !== 'string') {
      continue
    }
    const positions = parsePositions(row.positions)
    const citation: KnowledgeCitation = {
      index: row.index as number,
      chunk_index: row.chunk_index as number,
      document_id: row.document_id,
      document_name: row.document_name,
      quote: row.quote,
      ...(typeof row.chunk_id === 'string' ? { chunk_id: row.chunk_id } : {}),
      ...(typeof row.page === 'number' && Number.isFinite(row.page) ? { page: row.page } : {}),
      ...(positions.length > 0 ? { positions } : {}),
    }
    out.push(citation)
  }
  return out
}

function parsePositions(raw: unknown): CitationPosition[] {
  if (!Array.isArray(raw)) return []
  const out: CitationPosition[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    if (typeof row.page !== 'number' || typeof row.left !== 'number' || typeof row.right !== 'number' ||
      typeof row.top !== 'number' || typeof row.bottom !== 'number') {
      continue
    }
    out.push({
      page: row.page, left: row.left, right: row.right, top: row.top, bottom: row.bottom,
    })
  }
  return out
}
