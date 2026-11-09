/** Document fields used for parse-status display and polling. */
export type DocumentParseFields = {
  run: string
  progress: number
}

/** Whether RAGFlow has finished chunking so retrieval / preview ask can use the file.
 * @param document - Listed knowledge document.
 */
export function documentParseReady(document: DocumentParseFields): boolean {
  const run = document.run.trim().toUpperCase()
  if (run === 'DONE' || run === '3') return true
  if (documentParseFailed(document)) return false
  return Number.isFinite(document.progress) && document.progress >= 1
}

/** Whether RAGFlow reported a parse failure.
 * @param document - Listed knowledge document.
 */
export function documentParseFailed(document: DocumentParseFields): boolean {
  const run = document.run.trim().toUpperCase()
  return run === 'FAIL' || run === '4' || run === 'CANCEL' || run === '2'
}

/** Whether the file is waiting for or still running chunking.
 * @param document - Listed knowledge document.
 */
export function documentIsParsing(document: DocumentParseFields): boolean {
  if (documentParseReady(document) || documentParseFailed(document)) return false
  const run = document.run.trim().toUpperCase()
  return run === '' || run === '0' || run === 'UNSTART' || run === '1' || run === 'RUNNING'
}

/** Whole-percent progress for the 解析中… label.
 * @param document - Listed knowledge document.
 * @returns Integer 0–100.
 */
export function documentParsePercent(document: DocumentParseFields): number {
  if (!Number.isFinite(document.progress) || document.progress <= 0) return 0
  if (document.progress >= 1) return 100
  return Math.max(0, Math.min(99, Math.round(document.progress * 100)))
}
