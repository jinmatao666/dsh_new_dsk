import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import * as pdfjs from 'pdfjs-dist'
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.min.mjs'
import { productText } from './locales/product.ts'

const ThumbnailSettled = createContext<(id: string) => void>(() => {})

/** Reveal a page of cards after every PDF preview finishes, including failures.
 * @param props - PDF identities and mounted file cards for one page.
 * @returns File cards or a compact loading status.
 */
export function DocumentThumbnailPage({ documentIds, children }: {
  documentIds: string[]
  children: ReactNode
}) {
  const [settled, setSettled] = useState<Set<string>>(() => new Set())
  const onSettled = useCallback((id: string) => {
    setSettled(previous => new Set(previous).add(id))
  }, [])
  const loading = documentIds.some(id => !settled.has(id))
  return <ThumbnailSettled.Provider value={onSettled}>
    <div className="dsh-knowledge-thumbnail-page" aria-busy={loading}>
      {loading && <DocumentListLoading />}
      <div className="dsh-knowledge-documents" hidden={loading}>{children}</div>
    </div>
  </ThumbnailSettled.Provider>
}

/** Loading status centered in the available file-list area.
 * @returns Spinner and localized loading label.
 */
export function DocumentListLoading() {
  return <div className="dsh-knowledge-thumbnail-loading" role="status">
    <span aria-hidden="true" />
    {productText('加载中')}
  </div>
}

/** Render the original PDF first page and report completion to its page.
 * @param props - Document identity, file loader, and unsupported-format icon.
 * @returns First-page canvas with a PDF badge, or file icon.
 */
export function DocumentThumbnail({ documentId, kind, load, fallback }: {
  documentId: string
  kind: string
  load: () => Promise<{ bytes: Uint8Array }>
  fallback: ReactNode
}) {
  const onSettled = useContext(ThumbnailSettled)
  const canvas = useRef<HTMLCanvasElement>(null)
  const loader = useRef(load)
  loader.current = load
  const [ready, setReady] = useState(false)
  useEffect(() => {
    setReady(false)
    if (kind !== 'pdf') return
    let cancelled = false
    let task: ReturnType<typeof pdfjs.getDocument> | undefined
    void (async () => {
      const file = await loader.current()
      if (cancelled) return
      Object.assign(globalThis, { pdfjsWorker: { WorkerMessageHandler } })
      task = pdfjs.getDocument({ data: file.bytes.slice() })
      const pdf = await task.promise
      const page = await pdf.getPage(1)
      if (cancelled || canvas.current === null) return
      const viewport = page.getViewport({ scale: 260 / page.getViewport({ scale: 1 }).width })
      const target = canvas.current
      target.width = Math.ceil(viewport.width)
      target.height = Math.ceil(viewport.height)
      const context = target.getContext('2d')
      if (context === null) return
      await page.render({ canvasContext: context, viewport }).promise
      if (!cancelled) setReady(true)
    })().finally(() => task?.destroy()).catch(() => {
      // File download, PDF decoding, or worker disposal failure must not block the page.
    }).finally(() => {
      if (!cancelled) onSettled(documentId)
    })
    return () => { cancelled = true }
  }, [documentId, kind, onSettled])
  return <span className={`dsh-knowledge-thumbnail ${kind}`} aria-hidden="true">
    <canvas ref={canvas} hidden={!ready} />
    {!ready && (kind === 'pdf' ? fallback : <DocumentCover kind={kind} />)}
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
        : kind === 'word' ? <span className="dsh-knowledge-cover-word">W</span>
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
