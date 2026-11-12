import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.min.mjs'
import { productText } from './locales/product.ts'

/** Loading status centered in the available file-list area.
 * @returns Spinner and localized loading label.
 */
export function DocumentListLoading() {
  return <div className="dsh-knowledge-thumbnail-loading" role="status">
    <span aria-hidden="true" />
    {productText('加载中')}
  </div>
}

/** Show a default cover immediately and replace it with the PDF first page when ready.
 * @param props - Document identity, file kind, and PDF byte loader.
 * @returns A decorative cover with a file-type badge.
 */
export function DocumentThumbnail({ documentId, kind, load }: {
  documentId: string
  kind: string
  load: () => Promise<{ bytes: Uint8Array }>
}) {
  const cover = useRef<HTMLSpanElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const loader = useRef(load)
  loader.current = load
  const [renderedId, setRenderedId] = useState<string>()
  const ready = kind === 'pdf' && renderedId === documentId
  useEffect(() => {
    if (kind !== 'pdf' || cover.current === null) return
    const element = cover.current
    let cancelled = false
    const renderFirstPage = async () => {
      const file = await loader.current()
      if (cancelled) return
      Object.assign(globalThis, { pdfjsWorker: { WorkerMessageHandler } })
      const task = pdfjs.getDocument({ data: file.bytes.slice() })
      try {
        const pdf = await task.promise
        if (cancelled) return
        const page = await pdf.getPage(1)
        const target = canvas.current
        if (cancelled || target === null) return
        const viewport = page.getViewport({ scale: 260 / page.getViewport({ scale: 1 }).width })
        target.width = Math.ceil(viewport.width)
        target.height = Math.ceil(viewport.height)
        const context = target.getContext('2d')
        if (context === null) return
        await page.render({ canvasContext: context, viewport }).promise
        if (!cancelled) setRenderedId(documentId)
      } finally {
        await task.destroy()
      }
    }
    const start = () => {
      if (cancelled) return
      void renderFirstPage().catch(() => {
        // Download or PDF render failures leave the default cover visible.
      })
    }
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries, observer) => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      start()
    }) : undefined
    if (observer === undefined) start()
    else observer.observe(element)
    return () => {
      cancelled = true
      observer?.disconnect()
    }
  }, [documentId, kind])
  return <span ref={cover} className={`dsh-knowledge-thumbnail ${kind}`} aria-hidden="true">
    {kind === 'pdf' && <canvas key={documentId} ref={canvas} hidden={!ready} />}
    {!ready && <DocumentCover kind={kind} />}
    <span className="dsh-knowledge-thumbnail-badge">{kind === 'pdf' ? 'P' : kind === 'word' ? 'W' : kind === 'audio' ? <AudioBadgeIcon /> : kind === 'image' ? <CoverImageIcon /> : kind === 'web' ? <WebBadgeIcon /> : 'D'}</span>
  </span>
}

/** Decorative stationery for files without a rendered PDF first page. */
function DocumentCover({ kind }: { kind: string }) {
  return <span className={`dsh-knowledge-document-cover ${kind}`}>
    <span className="dsh-knowledge-cover-header"><i /><i /></span>
    <span className="dsh-knowledge-cover-art">
      {kind === 'image' ? <CoverImageIcon /> : kind === 'audio'
        ? <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M8 28v8m8-16v24m8-30v36m8-27v18m8-33v48m8-36v24m8-15v6" />
        </svg>
        : kind === 'word' || kind === 'pdf' ? <span className="dsh-knowledge-cover-file">{kind === 'pdf' ? productText('PDF') : 'W'}</span>
          : <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="12" y="10" width="40" height="44" rx="5" />
            <path d="M12 22h40m-29-6h1m6 0h1M22 32h20M22 40h15" />
          </svg>}
    </span>
    <span className="dsh-knowledge-cover-lines"><i /><i /><i /></span>
  </span>
}

/** Landscape outline shared by image covers and their corner mark. */
function CoverImageIcon() {
  return <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="8" y="12" width="48" height="40" rx="5" />
    <circle cx="23" cy="25" r="4" />
    <path d="m9 44 13-12 12 11 9-8 12 11" />
  </svg>
}

/** Compact vector music note for audio cover corners. */
function AudioBadgeIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 17V6l10-2v11M9 9l10-2" />
    <ellipse cx="6" cy="17.5" rx="3" ry="2.5" fill="currentColor" stroke="none" />
    <ellipse cx="16" cy="15.5" rx="3" ry="2.5" fill="currentColor" stroke="none" />
  </svg>
}

/** Globe mark for web cover corners. */
function WebBadgeIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="12" cy="12" r="8.5" />
    <ellipse cx="12" cy="12" rx="3.8" ry="8.5" />
    <path d="M3.5 12h17M5 7.5h14M5 16.5h14" />
  </svg>
}
