import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.min.mjs'
import type { CitationPosition } from './citations.ts'
import { ViewerLoading } from './ViewerLoading.tsx'
import { productText } from './locales/product.ts'

type PdfjsWorkerHost = { pdfjsWorker?: { WorkerMessageHandler: typeof WorkerMessageHandler } }

/** Install the worker API on the main thread so pdf.js never fetches pdf.worker.mjs. */
function ensureMainThreadPdfWorker(): void {
  const host = globalThis as PdfjsWorkerHost
  if (host.pdfjsWorker?.WorkerMessageHandler === undefined) {
    host.pdfjsWorker = { WorkerMessageHandler }
  }
}

export type PdfLocateRequest = {
  page?: number | undefined
  quote?: string | undefined
  positions?: CitationPosition[] | undefined
}

type HighlightBox = { left: number; top: number; width: number; height: number }

type PageLayer = {
  pageNumber: number
  width: number
  height: number
  dataUrl: string
  highlights: HighlightBox[]
}

/** Render a PDF with pdf.js canvases and optional RAGFlow locate highlights.
 * @param props - File bytes and optional auto-follow locate target.
 * @returns Scrollable page stack.
 */
export function PdfLocateViewer({
  bytes,
  locate,
}: {
  bytes: Uint8Array
  locate?: PdfLocateRequest | undefined
}) {
  const [pages, setPages] = useState<PageLayer[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const scroller = useRef<HTMLDivElement>(null)
  const targetPage = useRef<number>()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setPages([])
    targetPage.current = undefined
    void (async () => {
      try {
        ensureMainThreadPdfWorker()
        const task = pdfjs.getDocument({
          data: bytes.slice(),
          useWorkerFetch: false,
          isEvalSupported: false,
        })
        const pdf = await task.promise
        const rendered: PageLayer[] = []
        const locatePageCandidates = pageCandidates(locate)
        let applied = false
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) {
            await pdf.destroy()
            return
          }
          const page = await pdf.getPage(pageNumber)
          const viewport = page.getViewport({ scale: 1 })
          const scale = Math.min(1.35, 900 / Math.max(viewport.width, 1))
          const draw = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(draw.width)
          canvas.height = Math.ceil(draw.height)
          const context = canvas.getContext('2d')
          if (context === null) continue
          await page.render({ canvasContext: context, viewport: draw }).promise
          let highlights: HighlightBox[] = []
          if (!applied && locatePageCandidates.includes(pageNumber)) {
            highlights = boxesForPage(locate, pageNumber, viewport.width, viewport.height)
              .map(box => scaleBox(box, scale))
            if (highlights.length === 0 && (locate?.quote ?? '') !== '') {
              const quoteBox = await findQuoteBox(page, locate?.quote ?? '', viewport.width, viewport.height)
              if (quoteBox !== undefined) highlights = [scaleBox(quoteBox, scale)]
            }
            if (highlights.length === 0) {
              highlights = [scaleBox(fallbackBox(viewport.width, viewport.height), scale)]
            }
            targetPage.current = pageNumber
            applied = true
          }
          rendered.push({
            pageNumber,
            width: canvas.width,
            height: canvas.height,
            dataUrl: canvas.toDataURL('image/png'),
            highlights,
          })
        }
        if (!applied && locate !== undefined && pdf.numPages > 0) {
          const pageNumber = Math.min(Math.max(locatePageCandidates[0] ?? 1, 1), pdf.numPages)
          const layer = rendered.find(page => page.pageNumber === pageNumber)
          if (layer !== undefined) {
            const page = await pdf.getPage(pageNumber)
            const viewport = page.getViewport({ scale: 1 })
            const scale = layer.width / Math.max(viewport.width, 1)
            layer.highlights = [scaleBox(fallbackBox(viewport.width, viewport.height), scale)]
            targetPage.current = pageNumber
          }
        }
        await pdf.destroy()
        if (!cancelled) setPages(rendered)
      } catch (cause) {
        if (!cancelled) setError(`${productText('打开失败')}：${String(cause)}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [bytes, locate])

  useEffect(() => {
    if (loading || targetPage.current === undefined) return
    const node = scroller.current?.querySelector(`[data-page="${targetPage.current}"]`)
    if (node !== null && node !== undefined && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'center' })
    }
  }, [loading, pages])

  if (loading) return <ViewerLoading label={productText('正在加载…')} />
  if (error !== '') return <p role="alert">{error}</p>
  return <div className="dsh-knowledge-pdf" ref={scroller}>
    {pages.map(page =>
      <div className="dsh-knowledge-pdf-page" data-page={page.pageNumber} key={page.pageNumber}
        style={{ width: page.width, height: page.height }}>
        <img src={page.dataUrl} alt={`${productText('PDF')} ${page.pageNumber}`} width={page.width} height={page.height} />
        {page.highlights.map((box, index) =>
          <span key={`${page.pageNumber}-${index}`} className="dsh-knowledge-pdf-hit" style={{
            left: box.left, top: box.top, width: box.width, height: box.height,
          }} />)}
      </div>)}
  </div>
}

function pageCandidates(locate: PdfLocateRequest | undefined): number[] {
  if (locate === undefined) return []
  const values = new Set<number>()
  for (const position of locate.positions ?? []) {
    if (Number.isFinite(position.page)) {
      values.add(position.page)
      values.add(position.page + 1)
    }
  }
  if (typeof locate.page === 'number' && Number.isFinite(locate.page)) {
    values.add(locate.page)
    values.add(locate.page + 1)
  }
  return [...values].filter(page => page >= 0).sort((left, right) => left - right)
}

function boxesForPage(
  locate: PdfLocateRequest | undefined,
  pageNumber: number,
  width: number,
  height: number,
): HighlightBox[] {
  const rows = (locate?.positions ?? []).filter(position =>
    position.page === pageNumber || position.page + 1 === pageNumber)
  return rows.map(position => normalizeBox(position, width, height)).filter(box => box.width > 0 && box.height > 0)
}

function normalizeBox(position: CitationPosition, pageWidth: number, pageHeight: number): HighlightBox {
  const unit = looksNormalized(position)
  const left = unit ? position.left * pageWidth : position.left
  const right = unit ? position.right * pageWidth : position.right
  const top = unit ? position.top * pageHeight : position.top
  const bottom = unit ? position.bottom * pageHeight : position.bottom
  // PDF origin is bottom-left in some exporters; RAGFlow usually uses top-left absolute boxes.
  const y1 = Math.min(top, bottom)
  const y2 = Math.max(top, bottom)
  return {
    left: Math.min(left, right),
    top: y1,
    width: Math.abs(right - left),
    height: Math.abs(y2 - y1),
  }
}

function looksNormalized(position: CitationPosition): boolean {
  return position.left >= 0 && position.right <= 1.05 && position.top >= 0 && position.bottom <= 1.05 &&
    position.right >= 0 && position.top <= 1.05
}

function scaleBox(box: HighlightBox, scale: number): HighlightBox {
  return {
    left: box.left * scale,
    top: box.top * scale,
    width: box.width * scale,
    height: box.height * scale,
  }
}

function fallbackBox(pageWidth: number, pageHeight: number): HighlightBox {
  const width = pageWidth * 0.72
  const height = Math.min(120, pageHeight * 0.12)
  return {
    left: (pageWidth - width) / 2,
    top: pageHeight * 0.42,
    width,
    height,
  }
}

async function findQuoteBox(
  page: { getTextContent: () => Promise<{ items: Array<Record<string, unknown>> }> },
  quote: string,
  pageWidth: number,
  pageHeight: number,
): Promise<HighlightBox | undefined> {
  const needle = normalizeQuote(quote)
  if (needle.length < 4) return undefined
  const content = await page.getTextContent()
  const pieces: Array<{ text: string; left: number; top: number; width: number; height: number }> = []
  for (const item of content.items) {
    if (typeof item.str !== 'string' || item.str.trim() === '') continue
    const transform = Array.isArray(item.transform) ? item.transform as number[] : []
    const left = transform[4] ?? 0
    const top = pageHeight - (transform[5] ?? 0)
    const width = typeof item.width === 'number' ? item.width : Math.max(needle.length * 4, 24)
    const height = typeof item.height === 'number' ? item.height : 14
    pieces.push({ text: item.str, left, top: top - height, width, height })
  }
  const joined = pieces.map(piece => piece.text).join('')
  const normalizedJoined = normalizeQuote(joined)
  const hit = normalizedJoined.indexOf(needle.slice(0, Math.min(needle.length, 48)))
  if (hit < 0) {
    const article = needle.match(/第[一二三四五六七八九十百千0-9]+条/)?.[0]
    if (article === undefined) return undefined
    const articleHit = normalizedJoined.indexOf(normalizeQuote(article))
    if (articleHit < 0) return undefined
    return boxAround(pieces, articleHit, article.length, pageWidth, pageHeight)
  }
  return boxAround(pieces, hit, Math.min(needle.length, 64), pageWidth, pageHeight)
}

function boxAround(
  pieces: Array<{ text: string; left: number; top: number; width: number; height: number }>,
  start: number,
  length: number,
  pageWidth: number,
  pageHeight: number,
): HighlightBox | undefined {
  let cursor = 0
  const covered: typeof pieces = []
  for (const piece of pieces) {
    const next = cursor + normalizeQuote(piece.text).length
    if (next > start && cursor < start + length) covered.push(piece)
    cursor = next
  }
  if (covered.length === 0) return fallbackBox(pageWidth, pageHeight)
  const left = Math.min(...covered.map(piece => piece.left))
  const top = Math.min(...covered.map(piece => piece.top))
  const right = Math.max(...covered.map(piece => piece.left + piece.width))
  const bottom = Math.max(...covered.map(piece => piece.top + piece.height))
  return { left, top, width: Math.max(right - left, 24), height: Math.max(bottom - top, 14) }
}

function normalizeQuote(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase()
}
