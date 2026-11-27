import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { WordPreview } from './WordPreview.tsx'
import { SpreadsheetPreview } from './SpreadsheetPreview.tsx'
import { encodePreviewText, replaceWorkspaceWordText, workspacePreviewDigest } from './workspace-preview-edit.ts'
import './WorkspaceFiles.css'

export const WORKSPACE_FILE_DRAG = 'application/x-buddy-workspace-file'
export const WORKSPACE_PREVIEW_REQUEST = 'buddy:workspace-preview-request'
type Entry = { name: string; directory: boolean }
type Invoke = (command: string, input: { root: string; parts: string[]; expected?: string; content?: string }) => Promise<unknown>
type Preview = { kind: 'text' | 'html' | 'image' | 'pdf' | 'word' | 'sheet'; content: string }

const images: Record<string, string> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp', bmp: 'bmp', avif: 'avif' }
const fileBadges: Record<string, string> = {
  docx: 'W', doc: 'W', pdf: 'PDF', txt: 'TXT',
  md: 'MD', markdown: 'MD', html: 'HTML', htm: 'HTML',
  xls: 'XLS', xlsx: 'XLS', ppt: 'PPT', pptx: 'PPT',
}

function fileBadge(entry: Entry): string {
  if (entry.directory) return '▸'
  const extension = entry.name.split('.').at(-1)?.toLowerCase() ?? ''
  return fileBadges[extension] ?? (images[extension] ? 'IMG' : '▧')
}

async function previewFile(encoded: string, name: string): Promise<Preview> {
  const extension = name.split('.').at(-1)?.toLowerCase() ?? ''
  if (images[extension]) return { kind: 'image', content: 'data:image/' + images[extension] + ';base64,' + encoded }
  if (extension === 'xlsx') return { kind: 'sheet', content: encoded }
  if (extension === 'pdf') return { kind: 'pdf', content: encoded }
  if (extension === 'docx') return { kind: 'word', content: encoded }
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
  const source = new TextDecoder().decode(bytes)
  if (extension === 'html' || extension === 'htm') return { kind: 'html', content: source }
  if (extension === 'md' || extension === 'markdown') {
    const { marked } = await import('marked')
    return { kind: 'html', content: await marked.parse(source) }
  }
  if (extension === 'txt') return { kind: 'text', content: source }
  throw new Error('该格式暂不支持预览')
}

function PdfPreview({ content }: { content: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const textLayer = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState(1)
  const [count, setCount] = useState(1)
  const [error, setError] = useState('')
  const [document, setDocument] = useState<Awaited<ReturnType<typeof import('pdfjs-dist')['getDocument']>['promise']>>()
  useEffect(() => {
    let live = true
    let task: ReturnType<typeof import('pdfjs-dist')['getDocument']> | undefined
    void Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs')]).then(async ([pdf, worker]) => {
      if (!live) return
      const host = globalThis as typeof globalThis & { pdfjsWorker?: typeof worker }
      host.pdfjsWorker ??= worker
      task = pdf.getDocument({ data: Uint8Array.from(atob(content), c => c.charCodeAt(0)), isEvalSupported: false })
      const loaded = await task.promise
      if (live) { setCount(loaded.numPages); setDocument(loaded) }
    }).catch(() => { if (live) setError('无法读取此 PDF') })
    return () => { live = false; void task?.destroy().catch(() => {}) }
  }, [content])
  useEffect(() => {
    let live = true
    let cancelCanvas: (() => void) | undefined
    let cancelText: (() => void) | undefined
    const text = textLayer.current
    text?.replaceChildren()
    if (document) void Promise.all([document.getPage(page), import('pdfjs-dist')]).then(async ([sheet, pdf]) => {
      const target = canvas.current
      const context = target?.getContext('2d')
      if (!live || !target || !context || !text) return
      const unitWidth = sheet.getViewport({ scale: 1 }).width
      const available = target.parentElement?.parentElement?.clientWidth || unitWidth
      const viewport = sheet.getViewport({ scale: Math.min(1.5, available / unitWidth) })
      target.width = Math.ceil(viewport.width)
      target.height = Math.ceil(viewport.height)
      text.style.setProperty('--scale-factor', String(viewport.scale))
      const render = sheet.render({ canvasContext: context, viewport })
      cancelCanvas = () => render.cancel()
      const layer = new pdf.TextLayer({ textContentSource: sheet.streamTextContent(), container: text, viewport })
      cancelText = () => layer.cancel()
      await Promise.all([render.promise, layer.render()])
    }).catch(() => { if (live) setError('无法渲染 PDF 页面') })
    return () => { live = false; cancelCanvas?.(); cancelText?.() }
  }, [document, page])
  return <>{error ? <p role="alert">{error}</p> : <>
    <div className="buddy-workspace-pdf-controls">
      <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
      <span>{document ? page + ' / ' + count : '正在加载 PDF…'}</span>
      <button type="button" disabled={page >= count} onClick={() => setPage(page + 1)}>下一页</button>
    </div>
    <div className="buddy-workspace-pdf-page">
      <canvas ref={canvas} aria-label={'PDF 第 ' + page + ' 页'} />
      <div ref={textLayer} className="buddy-workspace-pdf-text" />
    </div>
  </>}</>
}

const htmlPrefix = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; form-action \'none\'"><style>body{font:15px/1.65 system-ui;margin:24px;overflow-wrap:anywhere}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:5px}</style>'

/** Browse the active workspace and preview files without modifying them. */
export function WorkspaceFiles({ root, invoke, workspacePicker, open, setOpen }: {
  root: string
  invoke: Invoke
  workspacePicker?: ReactNode
  open: boolean
  setOpen: (open: boolean) => void
}) {
  const [expanded, setExpanded] = useState<string[][]>([])
  const [rows, setRows] = useState<Array<Entry & { parts: string[] }>>([])
  const [tabs, setTabs] = useState<string[][]>([])
  const pointer = useRef<{ x: number; y: number }>()
  const suppressClick = useRef(false)
  const [search, setSearch] = useState('')
  const [file, setFile] = useState<string[]>()
  const [preview, setPreview] = useState<Preview>()
  const [listError, setListError] = useState('')
  const [fileError, setFileError] = useState('')
  const [revision, setRevision] = useState(0)
  const [original, setOriginal] = useState<string>()
  const [draft, setDraft] = useState<string>()
  const [find, setFind] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const extension = file?.at(-1)?.split('.').at(-1)?.toLowerCase()
  const editing = draft !== undefined
  const editable = extension !== undefined && ['txt', 'md', 'markdown', 'html', 'htm', 'docx'].includes(extension)
  const acceptFile = (parts: string[]) => {
    setTabs(previous => previous.some(tab => tab.join('/') === parts.join('/')) ? previous : [...previous, parts])
    setFile(parts)
  }
  const startEditing = () => {
    if (original === undefined) return
    setFind('')
    setSaveError('')
    try {
      const source = extension === 'docx' ? '' : new TextDecoder('utf-8', { ignoreBOM: true, fatal: true })
        .decode(Uint8Array.from(atob(original), value => value.charCodeAt(0)))
      setDraft(source)
    } catch { setSaveError('当前只支持保存 UTF-8 编码的文本文件') }
  }
  const save = async () => {
    if (!file || original === undefined || draft === undefined || saving) return
    setSaving(true)
    setSaveError('')
    try {
      const content = extension === 'docx' ? await replaceWorkspaceWordText(original, find, draft)
        : encodePreviewText(draft)
      await invoke('save_workspace_preview', { root, parts: file, expected: await workspacePreviewDigest(original), content })
      setDraft(undefined)
      setRevision(value => value + 1)
    } catch (reason) { setSaveError(String(reason)) }
    finally { setSaving(false) }
  }
  useEffect(() => {
    const receive = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return
      const workspace = root.replace(/\\/gu, '/').replace(/\/+$/u, '')
      const path = event.detail.replace(/\\/gu, '/')
      const windows = /^[a-z]:/iu.test(workspace) || workspace.startsWith('//')
      const compare = (value: string) => windows ? value.toLowerCase() : value
      const prefix = workspace + '/'
      const absolute = path.startsWith('/') || /^[a-z]:/iu.test(path)
      if (absolute && !compare(path).startsWith(compare(prefix))) return
      const parts = (absolute ? path.slice(prefix.length) : path).replace(/^\.\//u, '').split('/')
      if (parts.some(part => !part || part === '.' || part === '..' || part.includes(':'))) return
      event.preventDefault()
      if (editing) return
      setTabs(previous => previous.some(tab => tab.join('/') === parts.join('/')) ? previous : [...previous, parts])
      setFile(parts)
      setOpen(true)
    }
    window.addEventListener(WORKSPACE_PREVIEW_REQUEST, receive)
    return () => { window.removeEventListener(WORKSPACE_PREVIEW_REQUEST, receive) }
  }, [root, setOpen, editing])
  useEffect(() => {
    if (!open) return
    let live = true
    let running = false
    const query = search.trim().toLowerCase()
    const refresh = async () => {
      if (running) return
      running = true
      try {
        const next: typeof rows = []
        let directories = 0
        const visit = async (parts: string[]) => {
          if (!live || directories >= 150 || next.length >= 5000) return
          directories++
          const entries = await invoke('list_workspace_preview', { root, parts }) as Entry[]
          for (const entry of entries) {
            if (!live || next.length >= 5000) return
            const path = [...parts, entry.name]
            if (!query || path.join('/').toLowerCase().includes(query)) next.push({ ...entry, parts: path })
            if (entry.directory && (query || expanded.some(value => value.join('/') === path.join('/')))) {
              try { await visit(path) } catch { /* A child directory may have disappeared. */ }
            }
          }
        }
        await visit([])
        if (live) {
          setRows(next)
          setListError(directories >= 150 ? '已达到搜索目录上限，请缩小工作区范围。' : '')
        }
      } catch (reason) {
        if (live) setListError(String(reason))
      } finally { running = false }
    }
    const start = window.setTimeout(() => { void refresh() }, query ? 250 : 0)
    const timer = window.setInterval(() => { if (!document.hidden) void refresh() }, 3000)
    return () => { live = false; window.clearTimeout(start); window.clearInterval(timer) }
  }, [open, root, search, expanded, invoke, revision])
  useEffect(() => {
    if (!open || file === undefined) return
    let live = true
    setPreview(undefined); setFileError(''); setSaveError(''); setOriginal(undefined)
    const converted = extension === 'doc' ? 'docx' : extension === 'xls' ? 'xlsx'
      : extension === 'ppt' || extension === 'pptx' ? 'pdf' : undefined
    void invoke(converted ? 'convert_workspace_preview' : 'read_workspace_preview', { root, parts: file })
      .then(async (encoded) => {
        const raw = String(encoded)
        const rendered = await previewFile(raw, converted ? 'document.' + converted : file.at(-1) ?? '')
        if (live) { setPreview(rendered); setOriginal(raw) }
      }).catch((reason) => { if (live) setFileError(String(reason)) })
    return () => { live = false }
  }, [open, root, file, invoke, revision, extension])
  return <>
    <button type="button" className="wanwei-product-file-button" title="工作区文件" aria-label="工作区文件" aria-expanded={open} disabled={editing} onClick={() => setOpen(!open)}>▤</button>
    {open && createPortal(<aside className="buddy-workspace-files" aria-label="工作区文件">
      {file && <section className="buddy-workspace-preview" aria-label="文件预览">
        <header><select aria-label="切换已打开文件" disabled={editing} value={file.join('/')} onChange={(event) => {
          setFile(tabs.find(tab => tab.join('/') === event.target.value))
        }}>{tabs.map(tab => <option key={tab.join('/')} value={tab.join('/')}>{tab.join('/')}</option>)}</select>
        <button type="button" aria-label="重新加载当前文件" disabled={editing} onClick={() => setRevision(value => value + 1)}>↻</button>
        {!editing && editable && original !== undefined && <button type="button" onClick={startEditing}>编辑</button>}
        <button type="button" aria-label="关闭当前预览" disabled={editing} onClick={() => {
          const remaining = tabs.filter(tab => tab.join('/') !== file.join('/'))
          setTabs(remaining)
          setFile(remaining.at(-1))
        }}>×</button></header>
        <div className="buddy-workspace-preview-body">
          {!editing && saveError && <p role="alert">{saveError}</p>}
          {editing ? <div className="buddy-workspace-edit">
            {extension === 'docx' && <label>查找正文<input value={find} disabled={saving} onChange={event => setFind(event.target.value)} /></label>}
            <label>{extension === 'docx' ? '替换为' : '文件内容'}<textarea value={draft} disabled={saving} onChange={event => setDraft(event.target.value)} /></label>
            {saveError && <p role="alert">{saveError}</p>}
            <div><button type="button" disabled={saving} onClick={() => setDraft(undefined)}>放弃编辑</button>
              <button type="button" disabled={saving || extension === 'docx' && !find} onClick={() => { void save() }}>{saving ? '正在保存…' : '保存'}</button></div>
          </div> : fileError ? <p role="alert">{fileError}</p> : !preview ? <p role="status">正在加载预览…</p>
            : preview.kind === 'html' ? <iframe title={file.at(-1)} sandbox="" referrerPolicy="no-referrer" srcDoc={htmlPrefix + preview.content} />
              : preview.kind === 'image' ? <img src={preview.content} alt={file.at(-1)} />
                : preview.kind === 'word' ? <WordPreview key={file.join('/')} content={preview.content} name={file.at(-1) ?? 'Word'} />
                  : preview.kind === 'sheet' ? <SpreadsheetPreview key={file.join('/')} content={preview.content} />
                    : preview.kind === 'pdf' ? <PdfPreview key={file.join('/')} content={preview.content} />
                      : <pre>{preview.content}</pre>}
        </div>
      </section>}
      <section className="buddy-workspace-tree">
        <header><span>工作区文件</span><button type="button" aria-label="刷新文件" disabled={editing} onClick={() => setRevision(value => value + 1)}>↻</button><button type="button" aria-label="关闭文件栏" disabled={editing} onClick={() => setOpen(false)}>×</button></header>
        {!editing && workspacePicker}
        <input aria-label="搜索工作区文件" placeholder="搜索工作区文件" value={search} onChange={event => setSearch(event.target.value)} />
        {listError && <p role="status">{listError}</p>}
        <ul>{rows.map((entry) => {
          const parts = entry.parts
          const path = parts.join('/')
          const isExpanded = expanded.some(value => value.join('/') === path)
          return <li key={path}><button type="button" title={path} disabled={editing} draggable={!entry.directory}
            style={{ paddingInlineStart: search ? 6 : 6 + (parts.length - 1) * 12 }}
            aria-expanded={entry.directory ? Boolean(search) || isExpanded : undefined}
            aria-current={file?.join('/') === path ? 'true' : undefined}
            onPointerDown={(event) => {
              suppressClick.current = false
              if (event.button !== 0) return
              pointer.current = { x: event.clientX, y: event.clientY }
              event.currentTarget.setPointerCapture?.(event.pointerId)
            }}
            onPointerCancel={() => { pointer.current = undefined }}
            onPointerUp={(event) => {
              const start = pointer.current
              pointer.current = undefined
              if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return
              suppressClick.current = true
              const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-composer-card] [contenteditable="true"]')
              target?.dispatchEvent(new CustomEvent('buddy:workspace-file-drop', { bubbles: true, detail: { root, parts, directory: entry.directory } }))
            }}
            onDragStart={(event) => {
              if (pointer.current) { event.preventDefault(); return }
              event.dataTransfer.setData(WORKSPACE_FILE_DRAG, JSON.stringify({ root, parts }))
              event.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => {
              if (suppressClick.current) { suppressClick.current = false; return }
              if (entry.directory) {
                setExpanded(previous => isExpanded ? previous.filter(item => item.join('/') !== path) : [...previous, parts])
              } else {
                if (file?.join('/') !== path) { setPreview(undefined); setFileError(''); acceptFile(parts) }
              }
            }}><span className="buddy-workspace-file-badge" data-format={fileBadge(entry)} aria-hidden="true">{fileBadge(entry)}</span>
            {search ? path : entry.name}</button></li>
        })}</ul>
      </section>
    </aside>, document.body)}
  </>
}
