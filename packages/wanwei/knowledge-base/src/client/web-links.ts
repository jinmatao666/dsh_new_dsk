/** Maximum public page URLs accepted in one import dialog submission. */
export const WEB_LINK_MAX_COUNT = 10

/**
 * http(s) URLs with a host. Used as a first-pass filter before `URL` parsing.
 * Rejects whitespace and schemes other than http/https.
 */
const WEB_LINK_HOST = String.raw`[a-z0-9](?:[a-z0-9-]*[a-z0-9])?`
const WEB_LINK_PATTERN = new RegExp(
  String.raw`^https?:\/\/${WEB_LINK_HOST}(?:\.${WEB_LINK_HOST})*(?::\d{1,5})?(?:\/[^\s]*)?$`,
  'i',
)

/** Split textarea input into non-empty trimmed lines.
 * @param raw - Dialog textarea value.
 */
export function splitWebLinkLines(raw: string): string[] {
  return raw.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '')
}

/** Whether one line is an absolute public http(s) URL.
 * @param value - Single trimmed line from the dialog.
 */
export function isValidWebLink(value: string): boolean {
  if (!WEB_LINK_PATTERN.test(value)) return false
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    if (parsed.username !== '' || parsed.password !== '') return false
    const host = parsed.hostname.toLowerCase()
    if (host === '' || host === 'localhost' || host === '127.0.0.1' || host === '::1'
      || host.endsWith('.localhost') || host.endsWith('.local')) {
      return false
    }
    return true
  } catch {
    return false
  }
}

/** Result of validating the import-web-link dialog textarea. */
export type WebLinkParseResult =
  | { ok: true; urls: string[] }
  | { ok: false; messageKey: '请输入网页链接' | '一次最多导入 10 条链接' | '链接格式无效'; invalidLine?: string }

/** Validate newline-separated web links for import.
 * @param raw - Dialog textarea value.
 */
export function parseWebLinkInput(raw: string): WebLinkParseResult {
  const lines = splitWebLinkLines(raw)
  if (lines.length === 0) return { ok: false, messageKey: '请输入网页链接' }
  if (lines.length > WEB_LINK_MAX_COUNT) return { ok: false, messageKey: '一次最多导入 10 条链接' }
  const urls: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    if (!isValidWebLink(line)) return { ok: false, messageKey: '链接格式无效', invalidLine: line }
    if (seen.has(line)) continue
    seen.add(line)
    urls.push(line)
  }
  return { ok: true, urls }
}
