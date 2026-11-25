/** Original-file dialog displayed over the active conversation. */
import { useEffect, useState } from 'react'
import type { KnowledgeApi } from './KnowledgePage.tsx'
import { PdfLocateViewer } from './PdfLocateViewer.tsx'
import { ViewerLoading } from './ViewerLoading.tsx'
import { productText } from './locales/product.ts'

/** Open one authorized original from a chat citation. */
export type OpenChatSource = (libraryId: number, documentId: string, name: string, quote: string) => void

/** Render a PDF original without navigating away from the conversation.
 * @param props - Authorized file API and citation subscription.
 * @returns Conversation-local original preview.
 */
export function ChatSourcePreview({ api, subscribeSource }: {
  api: KnowledgeApi
  subscribeSource: (open: OpenChatSource) => () => void
}) {
  const [source, setSource] = useState<{ libraryId: number; id: string; name: string }>()
  const [bytes, setBytes] = useState<Uint8Array>()
  const [error, setError] = useState('')
  useEffect(() => subscribeSource((libraryId, id, name) => {
    setSource({ libraryId, id, name })
  }), [subscribeSource])
  useEffect(() => {
    if (source === undefined) return
    let active = true
    setBytes(undefined)
    setError('')
    void api.download(source.libraryId, source.id).then((file) => {
      if (active) setBytes(file.bytes)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { active = false }
  }, [api, source])
  useEffect(() => {
    if (source === undefined) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSource(undefined)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [source])
  if (source === undefined) return null
  return <div className="dsh-knowledge-viewer-shell">
    <section className="dsh-knowledge-viewer" role="dialog" aria-modal="true" aria-labelledby="chat-source-title">
      <header>
        <div className="dsh-knowledge-viewer-title"><h2 id="chat-source-title">{source.name}</h2></div>
        <button type="button" aria-label={productText('关闭')} onClick={() => setSource(undefined)}>×</button>
      </header>
      <div className="dsh-knowledge-viewer-body dsh-chat-source-body pdf">
        {error !== '' ? <p role="alert">{error}</p>
          : bytes === undefined ? <ViewerLoading label={productText('正在加载…')} />
            : <PdfLocateViewer bytes={bytes} />}
      </div>
    </section>
  </div>
}
