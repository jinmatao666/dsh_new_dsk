import { useEffect, useRef, useState } from 'react'
import runtime from './ParvisRuntime.ts?parvis-preview'
import type { PreviewTextSelection } from './parvis-preview-edit.ts'
import { WorkspaceFileIcon } from './WorkspaceFileIcon.tsx'

const formats: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel', xlsm: 'application/vnd.ms-excel', xlsb: 'application/vnd.ms-excel',
  csv: 'application/vnd.ms-excel', tsv: 'application/vnd.ms-excel', dbf: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf', md: 'text/markdown', markdown: 'text/markdown', html: 'text/html', htm: 'text/html', txt: 'text/plain',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml',
  json: 'text/plain', jsonl: 'text/plain', geojson: 'text/plain', xml: 'text/plain', log: 'text/plain',
  prj: 'text/plain', cpg: 'text/plain', yaml: 'text/plain', yml: 'text/plain', toml: 'text/plain', ini: 'text/plain',
  py: 'text/plain', js: 'text/plain', ts: 'text/plain', css: 'text/plain', sql: 'text/plain', sh: 'text/plain',
}

/** Run the original Parvis renderers in a sandbox; no workspace privileges enter the frame. */
export function ParvisPreview({ content, name, onSelection, onOpen }: {
  content: string
  name: string
  onSelection: (selection: PreviewTextSelection | undefined) => void
  onOpen?: (() => void) | undefined
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const mime = formats[name.split('.').at(-1)?.toLowerCase() ?? '']
  useEffect(() => {
    const receive = (event: MessageEvent<{ type?: string; message?: string; selection?: PreviewTextSelection } | undefined>) => {
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
    let text = mime?.startsWith('text/') ? new TextDecoder().decode(Uint8Array.from(atob(content), character => character.charCodeAt(0))) : undefined
    if (/\.(?:geo)?json$/iu.test(name) && text) {
      try { text = JSON.stringify(JSON.parse(text), null, 2) } catch { /* Retain invalid JSON as readable text. */ }
    }
    frame.current?.contentWindow?.postMessage({ type: 'buddy-preview-content', input: { content, name, mime, text, version: content.slice(-64) } }, '*')
  }, [ready, content, name, mime])
  if (!mime) return <div className="buddy-preview-fallback" role="status">
    <WorkspaceFileIcon name={name} /><strong>{name}</strong><p>此格式请使用对应的桌面应用查看。</p>
    {onOpen && <button type="button" className="buddy-file-primary" onClick={onOpen}>使用系统应用打开</button>}
  </div>
  return <>{error && <p role="alert">{error}</p>}<iframe ref={frame} title={name} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={runtime} /></>
}
