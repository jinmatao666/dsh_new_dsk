import { useMemo, type MouseEvent, type ReactNode } from 'react'
import {
  citationLocateHint,
  splitAnswerCitations,
  type KnowledgeCitation,
} from './citations.ts'
import { productText } from './locales/product.ts'
import { markdownToSafeHtml } from './markdown-html.ts'

/** Placeholder that survives marked without becoming a heading or list marker. */
const CITE_TOKEN = /⟦cite:(\d+)⟧/g

/** Render a knowledge answer as Markdown with clickable citation controls.
 * @param props - Answer text, citations, and locate opener.
 * @returns Structured answer body.
 */
export function AnswerBody({
  content,
  citations,
  onOpen,
}: {
  content: string
  citations: KnowledgeCitation[]
  onOpen: (citation: KnowledgeCitation, answerHint?: string) => void
}): ReactNode {
  const prepared = useMemo(() => prepareAnswerHtml(content, citations), [content, citations])
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const button = target.closest('button[data-cite]')
    if (!(button instanceof HTMLButtonElement)) return
    const index = Number(button.dataset.cite)
    const citation = prepared.citations[index]
    if (citation === undefined) return
    event.preventDefault()
    onOpen(citation, prepared.hints[index] ?? '')
  }
  return <div
    className="dsh-knowledge-answer"
    role="article"
    onClick={onClick}
    dangerouslySetInnerHTML={{ __html: prepared.html }}
  />
}

/** Build safe HTML with citation buttons for a knowledge answer.
 * @param content - Raw answer that may include RAGFlow markers.
 * @param citations - Locatable citation rows.
 * @returns HTML plus citation/hint tables keyed by button slot.
 */
export function prepareAnswerHtml(
  content: string,
  citations: KnowledgeCitation[],
): { html: string; citations: KnowledgeCitation[]; hints: string[] } {
  const parts = splitAnswerCitations(content, citations)
  const citeSlots: KnowledgeCitation[] = []
  const hints: string[] = []
  let markdown = ''
  let preceding = ''
  for (const part of parts) {
    if (part.type === 'text') {
      preceding += part.text
      markdown += part.text
      continue
    }
    const slot = citeSlots.length
    citeSlots.push(part.citation)
    hints.push(citationLocateHint(preceding))
    markdown += `⟦cite:${slot}⟧`
  }
  const html = markdownToSafeHtml(markdown).replace(CITE_TOKEN, (_match, raw: string) => {
    const slot = Number(raw)
    const citation = citeSlots[slot]
    if (citation === undefined) return ''
    const marker = `【${citation.index}】`
    const label = `${productText('引用定位')} ${marker}`
    return `<button type="button" class="dsh-knowledge-cite" data-cite="${slot}" aria-label="${escapeAttr(label)}">${escapeText(marker)}</button>`
  })
  return { html, citations: citeSlots, hints }
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
