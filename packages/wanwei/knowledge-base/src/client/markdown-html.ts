import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

/** Parse Markdown into HTML and strip script/handler surfaces.
 * @param source - Markdown text.
 * @returns Safer HTML string.
 */
export function markdownToSafeHtml(source: string): string {
  return sanitizeMarkdownHtml(marked.parse(source, { async: false }) as string)
}

/** Drop script/handlers and javascript: URLs from Markdown HTML.
 * @param html - Marked output.
 * @returns Safer HTML string.
 */
export function sanitizeMarkdownHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/\s(on\w+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\shref\s*=\s*("|')\s*javascript:[^"']*\1/gi, ' href="#"')
    .replace(/\ssrc\s*=\s*("|')\s*javascript:[^"']*\1/gi, '')
}
