import { useMemo } from 'react'
import { markdownToSafeHtml } from './markdown-html.ts'

/** Render Markdown as structured HTML for the knowledge document viewer.
 * @param props - Source Markdown text.
 * @returns Article with sanitized Markdown HTML.
 */
export function MarkdownView({ source }: { source: string }) {
  const html = useMemo(() => markdownToSafeHtml(source), [source])
  return <article className="dsh-knowledge-md" dangerouslySetInnerHTML={{ __html: html }} />
}
