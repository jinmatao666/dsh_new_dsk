import { useEffect, useRef, useState } from 'react'
import runtime from './ParvisRuntime.ts?parvis-preview'
import type { PreviewTextSelection } from './parvis-preview-edit.ts'

const formats: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf', md: 'text/markdown', markdown: 'text/markdown', html: 'text/html', htm: 'text/html', txt: 'text/plain',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml',
}

/** Run the original Parvis renderers in a sandbox; no workspace privileges enter the frame. */
export function ParvisPreview({ content, name, onSelection }: {
  content: string
  name: string
  onSelection: (selection: PreviewTextSelection | undefined) => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const mime = formats[name.split('.').at(-1)?.toLowerCase() ?? '']
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      if (event.data?.type === 'buddy-preview-ready') setReady(true)
      if (event.data?.type === 'buddy-preview-error') setError(String(event.data.message))
      if (event.data?.type === 'buddy-preview-selection') onSelection(event.data.selection)
    }
    window.addEventListener('message', receive)
    return () => { window.removeEventListener('message', receive) }
  }, [onSelection])
  useEffect(() => {
    if (!ready) return
    setError('')
    const text = mime?.startsWith('text/') ? new TextDecoder().decode(Uint8Array.from(atob(content), character => character.charCodeAt(0))) : undefined
    frame.current?.contentWindow?.postMessage({ type: 'buddy-preview-content', input: { content, name, mime, text, version: content.slice(-64) } }, '*')
  }, [ready, content, name, mime])
  if (!mime) return <p role="status">此文件类型暂不支持预览，请使用系统应用打开。</p>
  return <>{error && <p role="alert">{error}</p>}<iframe ref={frame} title={name} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={runtime} /></>
}
