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
  /** Unused for locate priority; kept so callers may still pass answer-side text. */
  hint?: string | undefined
  positions?: CitationPosition[] | undefined
}

type HighlightBox = { left: number; top: number; width: number; height: number }

type TextPiece = { text: string; left: number; top: number; width: number; height: number }

type PageGeom = {
  pageNumber: number
  width: number
  height: number
  dataUrl: string
  pageWidth: number
  pageHeight: number
  scale: number
  pieces: TextPiece[]
}

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
  const locateRef = useRef(locate)
  const geometryRef = useRef<PageGeom[]>([])
  locateRef.current = locate

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setPages([])
    geometryRef.current = []
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
        const byNumber = new Map<number, PageGeom>()
        const publish = () => {
          const geometry = [...byNumber.values()].sort((left, right) => left.pageNumber - right.pageNumber)
          geometryRef.current = geometry
          const located = paintLocate(geometry, locateRef.current)
          targetPage.current = located.target
          setPages(located.pages)
        }
        // Show the first finished page immediately; keep appending the rest.
        for (const pageNumber of pageRenderOrder(pdf.numPages, locateRef.current)) {
          if (cancelled) {
            await pdf.destroy()
            return
          }
          const geom = await renderPage(pdf, pageNumber, locateRef.current)
          if (geom === undefined) continue
          byNumber.set(pageNumber, geom)
          publish()
          if (byNumber.size === 1) setLoading(false)
          // Yield so the first pages paint before the rest finish encoding.
          await new Promise<void>(resolve => {
            requestAnimationFrame(() => resolve())
          })
        }
        await pdf.destroy()
        if (!cancelled && byNumber.size === 0) setLoading(false)
      } catch (cause) {
        if (!cancelled) {
          setError(`${productText('打开失败')}：${String(cause)}`)
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [bytes])

  useEffect(() => {
    const geometry = geometryRef.current
    if (geometry.length === 0) return
    const located = paintLocate(geometry, locate)
    targetPage.current = located.target
    setPages(located.pages)
  }, [locate])

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
        <img src={page.dataUrl} alt={`${productText('PDF')} ${page.pageNumber}`}
          width={page.width} height={page.height}
          style={{ width: page.width, height: page.height }} />
        {page.highlights.map((box, index) =>
          <span key={`${page.pageNumber}-${index}`} className="dsh-knowledge-pdf-hit" style={{
            left: box.left, top: box.top, width: box.width, height: box.height,
          }} />)}
      </div>)}
  </div>
}

/** Render locate-candidate pages first so citation jumps appear sooner.
 * @param numPages - PDF page count.
 * @param locate - Optional citation target.
 * @returns 1-based page numbers in render order.
 */
function pageRenderOrder(numPages: number, locate: PdfLocateRequest | undefined): number[] {
  const preferred = new Set(pageCandidates(locate).filter(page => page >= 1 && page <= numPages))
  const first = [...preferred].sort((left, right) => left - right)
  const rest: number[] = []
  for (let page = 1; page <= numPages; page += 1) {
    if (!preferred.has(page)) rest.push(page)
  }
  return first.length > 0 ? [...first, ...rest] : rest
}

async function renderPage(
  pdf: { getPage: (pageNumber: number) => Promise<{
    getViewport: (params: { scale: number }) => { width: number; height: number; transform: number[] }
    render: (params: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number; transform: number[] } }) => { promise: Promise<void> }
    getTextContent: () => Promise<{ items: Array<Record<string, unknown>> }>
  }> },
  pageNumber: number,
  locate: PdfLocateRequest | undefined,
): Promise<PageGeom | undefined> {
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const scale = Math.min(1.15, 860 / Math.max(viewport.width, 1))
  const draw = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(draw.width)
  canvas.height = Math.ceil(draw.height)
  const context = canvas.getContext('2d', { alpha: false })
  if (context === null) return undefined
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: context, viewport: draw }).promise
  const pieces = needsTextLayer(locate, pageNumber)
    ? await textPieces(page, viewport)
    : []
  return {
    pageNumber,
    width: canvas.width,
    height: canvas.height,
    // JPEG is much cheaper than PNG for full-page bitmaps.
    dataUrl: canvas.toDataURL('image/jpeg', 0.82),
    pageWidth: viewport.width,
    pageHeight: viewport.height,
    scale,
    pieces,
  }
}

/** Text search is only needed when a page has a quote and no chunk boxes.
 * @param locate - Citation locate payload.
 * @param pageNumber - 1-based page being rendered.
 * @returns Whether to extract the pdf.js text layer.
 */
function needsTextLayer(locate: PdfLocateRequest | undefined, pageNumber: number): boolean {
  if (locate === undefined || (locate.quote ?? '').trim() === '') return false
  const rows = locate.positions ?? []
  if (rows.length === 0) return true
  return !rows.some(position => position.page === pageNumber || position.page + 1 === pageNumber)
}

function paintLocate(geometry: PageGeom[], locate: PdfLocateRequest | undefined): { pages: PageLayer[]; target?: number } {
  const pages: PageLayer[] = geometry.map(page => ({
    pageNumber: page.pageNumber,
    width: page.width,
    height: page.height,
    dataUrl: page.dataUrl,
    highlights: [],
  }))
  if (locate === undefined || geometry.length === 0) return { pages }
  const candidates = pageCandidates(locate)
  for (const page of geometry) {
    if (candidates.length > 0 && !candidates.includes(page.pageNumber)) continue
    const highlights = highlightsForPage(locate, page)
    if (highlights.length === 0) continue
    const layer = pages.find(item => item.pageNumber === page.pageNumber)
    if (layer !== undefined) layer.highlights = highlights
    return { pages, target: page.pageNumber }
  }
  const pageNumber = Math.min(Math.max(candidates[0] ?? 1, 1), geometry.length)
  return { pages, target: pageNumber }
}

/** Prefer RAGFlow chunk boxes; fall back to quote text-layer search.
 * @param locate - Citation locate payload.
 * @param page - Rendered page geometry.
 * @returns Highlight boxes in canvas pixels.
 */
export function highlightsForPage(locate: PdfLocateRequest, page: {
  pageNumber: number
  pageWidth: number
  pageHeight: number
  scale: number
  pieces: TextPiece[]
}): HighlightBox[] {
  const raw = boxesForPage(locate, page.pageNumber, page.pageWidth, page.pageHeight)
  if (raw.length > 0) {
    return raw
      .map(box => scaleBox(clampBox(box, page.pageWidth, page.pageHeight), page.scale))
      .filter(box => box.width > 1 && box.height > 1)
  }
  const quoteBox = quoteBoxFromPieces(
    page.pieces,
    locate.quote ?? '',
    page.pageWidth,
    page.pageHeight,
  )
  if (quoteBox !== undefined) {
    return [scaleBox(clampBox(quoteBox, page.pageWidth, page.pageHeight), page.scale)]
  }
  return []
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
  if (rows.length === 0) return []
  const scale = positionSpaceScale(rows, width, height)
  return rows
    .map(position => normalizeBox(position, width, height, scale))
    .filter(box => box.width > 0 && box.height > 0)
}

/** Map RAGFlow absolute / unit / 0–1000 boxes onto pdf.js page points.
 * @param position - One RAGFlow position row.
 * @param pageWidth - pdf.js viewport width at scale 1.
 * @param pageHeight - pdf.js viewport height at scale 1.
 * @param space - Uniform scale from detected coordinate space into page points.
 * @returns Axis-aligned box in page points.
 */
export function normalizeBox(
  position: CitationPosition,
  pageWidth: number,
  pageHeight: number,
  space = { x: 1, y: 1 },
): HighlightBox {
  const unit = looksUnitNormalized(position)
  const left = (unit ? position.left * pageWidth : position.left * space.x)
  const right = (unit ? position.right * pageWidth : position.right * space.x)
  const top = (unit ? position.top * pageHeight : position.top * space.y)
  const bottom = (unit ? position.bottom * pageHeight : position.bottom * space.y)
  const y1 = Math.min(top, bottom)
  const y2 = Math.max(top, bottom)
  return {
    left: Math.min(left, right),
    top: y1,
    width: Math.abs(right - left),
    height: Math.abs(y2 - y1),
  }
}

/** Detect how RAGFlow page-image / 0–1000 coords relate to pdf.js page points.
 * @param rows - Positions for one page.
 * @param pageWidth - pdf.js page width.
 * @param pageHeight - pdf.js page height.
 * @returns Per-axis multipliers into page points.
 */
export function positionSpaceScale(
  rows: CitationPosition[],
  pageWidth: number,
  pageHeight: number,
): { x: number; y: number } {
  if (rows.length === 0 || rows.every(looksUnitNormalized)) return { x: 1, y: 1 }
  const maxRight = Math.max(...rows.map(row => Math.max(row.left, row.right)))
  const maxBottom = Math.max(...rows.map(row => Math.max(row.top, row.bottom)))
  if (maxRight <= 1.05 && maxBottom <= 1.05) return { x: pageWidth, y: pageHeight }
  // MinerU / some parsers emit 0–1000 layout space.
  if (maxRight <= 1000.5 && maxBottom <= 1000.5 &&
    (maxRight > pageWidth * 1.02 || maxBottom > pageHeight * 1.02)) {
    return { x: pageWidth / 1000, y: pageHeight / 1000 }
  }
  const oversized = maxRight > pageWidth * 1.02 || maxBottom > pageHeight * 1.02
  if (!oversized) return { x: 1, y: 1 }
  // DeepDoc renders pages at a fixed ZM; prefer that over fitting to the rightmost box
  // (box edges are not the page image size, so max-edge fit over-scales and overflows).
  for (const zoom of [3, 2, 2.5, 4, 1.5, 5]) {
    if (maxRight <= pageWidth * zoom * 1.08 && maxBottom <= pageHeight * zoom * 1.08) {
      return { x: 1 / zoom, y: 1 / zoom }
    }
  }
  const uniform = Math.min(
    maxRight > pageWidth * 1.02 ? pageWidth / maxRight : 1,
    maxBottom > pageHeight * 1.02 ? pageHeight / maxBottom : 1,
  )
  return { x: uniform, y: uniform }
}

function looksUnitNormalized(position: CitationPosition): boolean {
  return position.left >= 0 && position.right <= 1.05 && position.top >= 0 && position.bottom <= 1.05 &&
    position.right >= 0 && position.bottom >= 0
}

function clampBox(box: HighlightBox, pageWidth: number, pageHeight: number): HighlightBox {
  const left = Math.min(Math.max(box.left, 0), pageWidth)
  const top = Math.min(Math.max(box.top, 0), pageHeight)
  const right = Math.min(Math.max(box.left + box.width, 0), pageWidth)
  const bottom = Math.min(Math.max(box.top + box.height, 0), pageHeight)
  return {
    left,
    top,
    width: Math.max(right - left, 0),
    height: Math.max(bottom - top, 0),
  }
}

function scaleBox(box: HighlightBox, scale: number): HighlightBox {
  return {
    left: box.left * scale,
    top: box.top * scale,
    width: box.width * scale,
    height: box.height * scale,
  }
}

async function textPieces(
  page: {
    getTextContent: () => Promise<{ items: Array<Record<string, unknown>> }>
  },
  viewport: { transform: number[]; width: number; height: number },
): Promise<TextPiece[]> {
  const content = await page.getTextContent()
  const pieces: TextPiece[] = []
  for (const item of content.items) {
    if (typeof item.str !== 'string' || item.str.trim() === '') continue
    const itemTransform = Array.isArray(item.transform) ? item.transform as number[] : []
    const transform = pdfjs.Util.transform(viewport.transform, itemTransform)
    const left = transform[4] ?? 0
    const baseline = transform[5] ?? 0
    const height = Math.hypot(transform[2] ?? 0, transform[3] ?? 0) ||
      (typeof item.height === 'number' ? item.height : 14)
    const width = typeof item.width === 'number' && item.width > 0
      ? item.width * Math.hypot(transform[0] ?? 1, transform[1] ?? 0)
      : Math.max(item.str.length * height * 0.55, 12)
    pieces.push({
      text: item.str,
      left,
      top: baseline - height,
      width,
      height,
    })
  }
  return pieces
}

function quoteBoxFromPieces(
  pieces: TextPiece[],
  quote: string,
  pageWidth: number,
  pageHeight: number,
): HighlightBox | undefined {
  const needle = normalizeQuote(quote)
  if (pieces.length === 0 || needle.length < 4) return undefined
  const normalizedJoined = normalizeQuote(pieces.map(piece => piece.text).join(''))
  const hit = normalizedJoined.indexOf(needle.slice(0, Math.min(needle.length, 48)))
  if (hit < 0) return undefined
  return boxAround(pieces, hit, Math.min(needle.length, 64), pageWidth, pageHeight)
}

function boxAround(
  pieces: TextPiece[],
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
  if (covered.length === 0) return undefined
  const left = Math.min(...covered.map(piece => piece.left))
  const top = Math.min(...covered.map(piece => piece.top))
  const right = Math.max(...covered.map(piece => piece.left + piece.width))
  const bottom = Math.max(...covered.map(piece => piece.top + piece.height))
  return clampBox(
    { left, top, width: Math.max(right - left, 24), height: Math.max(bottom - top, 14) },
    pageWidth,
    pageHeight,
  )
}

function normalizeQuote(value: string): string {
  return value
    .replace(/[\s\u00a0\u3000]+/g, '')
    .replace(/[“”"‘’']/g, '')
    .replace(/[：:]/g, ':')
    .replace(/[，,]/g, ',')
    .replace(/[。．.]/g, '.')
    .toLowerCase()
}
