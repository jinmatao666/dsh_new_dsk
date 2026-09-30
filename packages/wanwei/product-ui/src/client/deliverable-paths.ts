/** Wanwei skill result parsing for successful tool output; never parses closing prose. */
const RESULT_PREFIX = 'WANWEI_RESULT='

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Extract explicit artifact paths, preserving macOS spaces and Chinese filenames.
 * @param text - Tool output containing product result or file-path markers.
 * @returns Distinct declared paths; failed shell output contributes no paths.
 */
export function wanweiDeliverablePaths(text: string): readonly string[] {
  if (/\[exit code: [1-9]\d*\]|\[shell killed by signal:|\[shell exited: code [1-9]\d*\]/u.test(text)) return []
  const paths: string[] = []
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed.startsWith(RESULT_PREFIX)) {
      try {
        const value: unknown = JSON.parse(trimmed.slice(RESULT_PREFIX.length))
        if (isRecord(value) && value.success !== false && Array.isArray(value.artifacts)) {
          for (const artifact of value.artifacts) {
            if (isRecord(artifact) && typeof artifact.path === 'string' && artifact.path.trim() !== '') {
              paths.push(artifact.path.trim())
            }
          }
        }
      } catch {
        // A malformed marker does not hide later valid artifacts.
      }
    }
    const explicit = /^(?:DSH_ANALYSIS_VIEW|DSH_EXCEL_PATH|DSH_WORD_PATH)=(.+)$/u.exec(trimmed)
    if (explicit?.[1]?.trim()) paths.push(explicit[1].trim())
  }
  return [...new Set(paths)]
}
