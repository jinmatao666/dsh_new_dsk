/** Recover the original page URL from stored HTML metadata.
 * Prefers the import-time `wanwei-source-url` meta, then canonical / og:url.
 * @param raw - Downloaded HTML text.
 * @returns Absolute http(s) URL, or undefined when none is recoverable.
 */
export function extractWebSourceUrl(raw: string): string | undefined {
  if (typeof DOMParser === 'undefined') return undefined
  const doc = new DOMParser().parseFromString(raw, 'text/html')
  return normalizeHttpUrl(
    firstNonEmpty(
      attrOf(doc.querySelector('meta[name="wanwei-source-url"]'), 'content'),
      attrOf(doc.querySelector('link[rel="canonical"]'), 'href'),
      attrOf(doc.querySelector('meta[property="og:url"]'), 'content'),
    ),
  )
}

/** Build same-origin HTML for an in-pane live preview of a stored web page.
 * Keeps site chrome (unlike a reader strip), injects `<base>` so relative
 * assets resolve against the source origin, and drops frame-blocking CSP metas
 * that would blank an embedded preview. Many public sites send
 * `X-Frame-Options: SAMEORIGIN`, so the preview loads this blob instead of the
 * raw source URL in an iframe.
 * @param raw - Downloaded HTML text.
 * @param sourceUrl - Absolute http(s) page URL used for `<base href>`.
 * @returns HTML document string for a blob iframe.
 */
export function prepareEmbeddedWebPreview(raw: string, sourceUrl: string): string {
  const base = normalizeHttpUrl(sourceUrl)
  if (base === undefined) return raw
  if (typeof DOMParser === 'undefined') {
    return `<!doctype html><html><head><base href="${escapeAttr(base)}"></head><body>${escapeHtml(raw)}</body></html>`
  }
  const doc = new DOMParser().parseFromString(raw, 'text/html')
  for (const node of [...doc.querySelectorAll('meta[http-equiv]')]) {
    const equiv = node.getAttribute('http-equiv')?.trim().toLowerCase() ?? ''
    if (equiv === 'content-security-policy') node.remove()
  }
  let baseEl = doc.querySelector('base')
  if (baseEl === null) {
    baseEl = doc.createElement('base')
    const head = doc.head ?? doc.documentElement?.appendChild(doc.createElement('head'))
    head?.insertBefore(baseEl, head.firstChild)
  }
  baseEl.setAttribute('href', base)
  // Keep in-pane navigation from replacing the blob with a framed live origin
  // that many sites refuse via X-Frame-Options; open outbound links separately.
  for (const anchor of doc.querySelectorAll('a[href]')) {
    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer')
  }
  const html = doc.documentElement?.outerHTML
  if (html === undefined || html === '') return raw
  return `<!doctype html>${html}`
}

function normalizeHttpUrl(candidate: string): string | undefined {
  if (candidate === '') return undefined
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    if (parsed.username !== '' || parsed.password !== '') return undefined
    return parsed.toString()
  } catch {
    return undefined
  }
}

function attrOf(node: Element | null, name: string): string {
  return node?.getAttribute(name)?.trim() ?? ''
}

function firstNonEmpty(...values: string[]): string {
  for (const value of values) {
    if (value !== '') return value
  }
  return ''
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;')
}
