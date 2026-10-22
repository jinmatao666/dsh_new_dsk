import { useMemo } from 'react'
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

/** Render Markdown as structured HTML for the knowledge document viewer.
 * @param props - Source Markdown text.
 * @returns Article with sanitized Markdown HTML.
 */
export function MarkdownView({ source }: { source: string }) {
  const html = useMemo(() => sanitizeMarkdownHtml(marked.parse(source, { async: false }) as string), [source])
  return <article className="dsh-knowledge-md" dangerouslySetInnerHTML={{ __html: html }} />
}

/** Drop script/handlers and javascript: URLs from Markdown HTML.
 * @param html - Marked output.
 * @returns Safer HTML string.
 */
function sanitizeMarkdownHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/\s(on\w+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\shref\s*=\s*("|')\s*javascript:[^"']*\1/gi, ' href="#"')
    .replace(/\ssrc\s*=\s*("|')\s*javascript:[^"']*\1/gi, '')
}
