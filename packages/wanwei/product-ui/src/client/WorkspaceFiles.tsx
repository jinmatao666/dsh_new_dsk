import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ParvisPreview } from './ParvisPreview.tsx'
import { buildTransformPrompt, insertAfterSelection, replaceDocxSelectionText, replaceSelectionText, insertDocxChartAfterSelection, pngBase64FromDataUrl, normalizeDocxForWordSave } from './parvis-preview-edit.ts'
import type { PreviewTextSelection } from './parvis-preview-edit.ts'
import { WorkspaceFileIcon } from './WorkspaceFileIcon.tsx'
import { encodePreviewText, workspacePreviewDigest } from './workspace-preview-edit.ts'
import './WorkspaceFiles.css'
import { inlinePreviewAssets } from './preview-assets.ts'

export const WORKSPACE_FILE_DRAG = 'application/x-buddy-workspace-file'
export const WORKSPACE_PREVIEW_REQUEST = 'buddy:workspace-preview-request'
type Entry = { name: string; directory: boolean; version?: string }
type Invoke = (command: string, input: {
  root: string
  parts: string[]
  expected?: string
  content?: string
  action?: string
  name?: string
}) => Promise<unknown>
type Preview = { content: string; name: string }

type SavedDraft = {
  draft: string
  find: string
  original: string
  binary?: string | undefined
  mode: 'replace' | 'insert'
  selection?: PreviewTextSelection | undefined
}
const workspaceMemory = new Map<string, {
  expanded: string[][]
  tabs: string[][]
  file?: string[] | undefined
  drafts: Map<string, SavedDraft>
}>()

/** Browse the active workspace and preview files without modifying them. */
export function WorkspaceFiles({ root, invoke, workspacePicker, open, setOpen, onPrompt, transformPreview }: {
  root: string
  onPrompt?: (prompt: string) => void
  transformPreview?: ((prompt: string, signal: AbortSignal) => Promise<string>) | undefined
  invoke: Invoke
  workspacePicker?: ReactNode
  open: boolean
  setOpen: (open: boolean) => void
}) {
  const memory = useRef(workspaceMemory.get(root) ?? { expanded: [], tabs: [], drafts: new Map<string, SavedDraft>() })
  const [expanded, setExpanded] = useState<string[][]>(memory.current.expanded)
  const [rows, setRows] = useState<Array<Entry & { parts: string[] }>>([])
  const [tabs, setTabs] = useState<string[][]>(memory.current.tabs)
  const pointer = useRef<{ x: number; y: number }>()
  const suppressClick = useRef(false)
  const [search, setSearch] = useState('')
  const [file, setFile] = useState<string[] | undefined>(memory.current.file)
  const [preview, setPreview] = useState<Preview>()
  const [listError, setListError] = useState('')
  const [fileError, setFileError] = useState('')
  const [revision, setRevision] = useState(0)
  const [original, setOriginal] = useState<string>()
  const [draft, setDraft] = useState<string>()
  const [find, setFind] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [modelBusy, setModelBusy] = useState(false)
  const [binaryDraft, setBinaryDraft] = useState<string>()
  const modelRequest = useRef<AbortController>()
  useEffect(() => () => modelRequest.current?.abort(), [])
  const [selection, setSelection] = useState<PreviewTextSelection>()
  const [mode, setMode] = useState<'replace' | 'insert'>('replace')
  const [previewWidth, setPreviewWidth] = useState(520)
  const [operation, setOperation] = useState<{ parts: string[]; action: string; name: string }>()
  const [operationError, setOperationError] = useState('')
  const fileVersion = useRef<string>()
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; name: string }>()
  useEffect(() => {
    memory.current.expanded = expanded; memory.current.tabs = tabs; memory.current.file = file
    workspaceMemory.set(root, memory.current)
  }, [root, expanded, tabs, file])
  useEffect(() => {
    if (!file || original === undefined) return
    if (draft === undefined) memory.current.drafts.delete(file.join('/'))
    else memory.current.drafts.set(file.join('/'), { draft, find, original, selection, binary: binaryDraft, mode })
  }, [file, draft, find, original, selection, binaryDraft, mode])
  const extension = file?.at(-1)?.split('.').at(-1)?.toLowerCase()
  const editing = draft !== undefined
  const editable = extension !== undefined && ['txt', 'md', 'markdown', 'html', 'htm', 'docx'].includes(extension)
  useEffect(() => {
    const clear = () => { pointer.current = undefined; setDragGhost(undefined) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') clear() }
    window.addEventListener('blur', clear); window.addEventListener('keydown', key)
    return () => { window.removeEventListener('blur', clear); window.removeEventListener('keydown', key) }
  }, [])
  useEffect(() => {
    document.body.style.setProperty('--buddy-preview-width', `${previewWidth}px`)
    return () => { document.body.style.removeProperty('--buddy-preview-width') }
  }, [previewWidth])
  useEffect(() => {
    const current = rows.find(entry => entry.parts.join('/') === file?.join('/'))?.version
    if (current && fileVersion.current && current !== fileVersion.current && !editing) setRevision(value => value + 1)
    fileVersion.current = current
  }, [rows, file, editing])
  const acceptFile = (parts: string[]) => {
    modelRequest.current?.abort(); setModelBusy(false); setBinaryDraft(undefined)
    setTabs(previous => previous.some(tab => tab.join('/') === parts.join('/')) ? previous : [...previous, parts])
    setOriginal(undefined); setDraft(undefined); setSelection(undefined)
    setExpanded((previous) => {
      const next = [...previous]
      for (let depth = 1; depth < parts.length; depth++) {
        const ancestor = parts.slice(0, depth)
        if (!next.some(value => value.join('/') === ancestor.join('/'))) next.push(ancestor)
      }
      return next
    })
    setFile(parts)
  }
  const startEditing = () => {
    if (original === undefined) return
    setFind(selection?.selectedText ?? '')
    setSaveError('')
    try {
      const source = extension === 'docx' ? '' : new TextDecoder('utf-8', { ignoreBOM: true, fatal: true })
        .decode(Uint8Array.from(atob(original), value => value.charCodeAt(0)))
      setDraft(selection ? selection.selectedText : source)
    } catch { setSaveError('当前只支持保存 UTF-8 编码的文本文件') }
  }
  const [editedPreview, setEditedPreview] = useState<string>()
  const buildEditedContent = async () => {
    if (original === undefined || draft === undefined) throw new Error('草稿尚未准备好')
    let content: string
    if (binaryDraft) content = binaryDraft
    else if (extension === 'docx') {
      const chosen = selection?.selectedText === find ? selection : { selectedText: find, contextBefore: '', contextAfter: '', menu: { x: 0, y: 0 } }
      const result = await replaceDocxSelectionText(original, chosen, mode === 'insert' ? find + draft : draft)
      if (!result.ok) throw new Error(result.reason === 'ambiguous' ? '这段文字出现多次，请在预览中重新选择。' : '没有找到选中文字，请重新选择。')
      content = result.base64
    } else if (selection && find) {
      const source = new TextDecoder('utf-8', { ignoreBOM: true }).decode(Uint8Array.from(atob(original), value => value.charCodeAt(0)))
      const result = mode === 'insert' ? insertAfterSelection(source, selection, draft) : replaceSelectionText(source, selection, draft)
      if (!result.ok) throw new Error('无法定位选中文字，请重新选择。')
      content = encodePreviewText(result.content)
    } else content = encodePreviewText(draft)
    return content
  }
  useEffect(() => {
    let live = true
    setEditedPreview(undefined)
    if (!file || draft === undefined || original === undefined || extension === 'docx' && !find && !binaryDraft) return
    const timer = window.setTimeout(() => {
      void buildEditedContent().then(value => inlinePreviewAssets(value, file, root, invoke))
        .then((value) => { if (live) setEditedPreview(value) }).catch(() => {})
    }, 250)
    return () => { live = false; window.clearTimeout(timer) }
  }, [draft, original, find, selection, mode, binaryDraft, extension, file, root, invoke])
  const save = async () => {
    if (!file || original === undefined || draft === undefined || saving) return
    setSaving(true)
    setSaveError('')
    try {
      const edited = await buildEditedContent()
      const content = extension === 'docx' ? await normalizeDocxForWordSave(edited) : edited
      await invoke('save_workspace_preview', { root, parts: file, expected: await workspacePreviewDigest(original), content })
      setDraft(undefined)
      setBinaryDraft(undefined)
      setRevision(value => value + 1)
    } catch (reason) { setSaveError(String(reason)) }
    finally { setSaving(false) }
  }
  const transform = async (action: 'polish' | 'expand' | 'shorten' | 'pie' | 'bar' | 'line') => {
    if (!selection || !original || !transformPreview || modelBusy) return
    const chosen = selection
    modelRequest.current?.abort()
    const controller = new AbortController(); modelRequest.current = controller
    setModelBusy(true); setSaveError('')
    try {
      const chart = action === 'pie' || action === 'bar' || action === 'line'
      const prompt = chart ? `根据以下文字生成${action}图的 ECharts option。精确使用原文数值，不要估算或编造。仅返回可 JSON.parse 的 JSON 对象，包含 title 和 series，禁止函数、工具调用和解释。\n\n${chosen.selectedText}` : buildTransformPrompt(chosen.selectedText, action)
      const replacement = await transformPreview(prompt, controller.signal)
      if (controller.signal.aborted) return
      if (chart) {
        const { renderChartToPng } = await import('./parvis-chart-renderer.ts')
        const option = JSON.parse(replacement.replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')) as Record<string, unknown>
        const png = await renderChartToPng(option)
        const result = await insertDocxChartAfterSelection(original, chosen, pngBase64FromDataUrl(png), '')
        if (!result.ok) throw new Error('无法定位图表插入位置，请重新选择。')
        setBinaryDraft(result.base64); setDraft(''); setFind(chosen.selectedText)
      } else { setMode('replace'); setFind(chosen.selectedText); setDraft(replacement) }
    } catch (reason) { if (!controller.signal.aborted) setSaveError(String(reason)) }
    finally { if (!controller.signal.aborted) setModelBusy(false) }
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
      acceptFile(parts)
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
      : extension === 'ppt' ? 'pdf' : undefined
    void invoke(converted ? 'convert_workspace_preview' : 'read_workspace_preview', { root, parts: file })
      .then(async (encoded) => {
        const raw = String(encoded)
        const rendered = { content: await inlinePreviewAssets(raw, file, root, invoke), name: converted ? 'document.' + converted : file.at(-1) ?? '' }
        if (live) {
          const saved = memory.current.drafts.get(file.join('/'))
          setPreview(rendered); setOriginal(saved?.original ?? raw)
          setDraft(saved?.draft); setFind(saved?.find ?? ''); setSelection(saved?.selection); setBinaryDraft(saved?.binary); setMode(saved?.mode ?? 'replace')
        }
      }).catch((reason) => { if (live) setFileError(String(reason)) })
    return () => { live = false }
  }, [open, root, file, invoke, revision, extension])
  return <>
    <button type="button" className="wanwei-product-file-button" title="工作区文件" aria-label="工作区文件" aria-expanded={open} disabled={editing} onClick={() => setOpen(!open)}>▤</button>
    {dragGhost && createPortal(<div className="buddy-file-drag-ghost" style={{ left: dragGhost.x + 12, top: dragGhost.y + 12 }}><span>↙</span><WorkspaceFileIcon name={dragGhost.name} />{dragGhost.name}</div>, document.body)}
    {open && createPortal(<aside className="buddy-workspace-files" aria-label="工作区文件">
      {file && <div className="buddy-workspace-resize" role="separator" aria-label="调整预览宽度" aria-orientation="vertical" tabIndex={0}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          setPreviewWidth(value => Math.max(300, Math.min(window.innerWidth - 560, value + (event.key === 'ArrowLeft' ? 20 : -20))))
        }}
        onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          setPreviewWidth(Math.max(300, Math.min(window.innerWidth - 560, window.innerWidth - 240 - event.clientX)))
        }} />}
      {file && <section className="buddy-workspace-preview" aria-label="文件预览">
        <header><select aria-label="切换已打开文件" value={file.join('/')} onChange={(event) => {
          const next = tabs.find(tab => tab.join('/') === event.target.value); if (next) acceptFile(next)
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
          {editing && <div className="buddy-workspace-edit">
            {(extension === 'docx' || selection) && <label>查找正文<input value={find} disabled={saving} onChange={event => setFind(event.target.value)} /></label>}
            {binaryDraft ? <p>图表已加入草稿，请预览后保存。</p> : <label>{extension === 'docx' ? '替换为' : '文件内容'}<textarea value={draft} disabled={saving} onChange={event => setDraft(event.target.value)} /></label>}
            {saveError && <p role="alert">{saveError}</p>}
            <div><button type="button" disabled={saving} onClick={() => { setDraft(undefined); setBinaryDraft(undefined); setRevision(value => value + 1) }}>放弃编辑</button>
              <button type="button" disabled={saving || extension === 'docx' && !find} onClick={() => { void save() }}>{saving ? '正在保存…' : '保存'}</button></div>
          </div>}
          {fileError ? <p role="alert">{fileError}</p> : !preview ? <p role="status">正在加载预览…</p>
            : <ParvisPreview key={file.join('/')} content={editedPreview ?? preview.content} name={preview.name} onSelection={editing ? () => {} : setSelection} />}
          {!editing && selection && <div className="buddy-selection-toolbar">
            <span title={selection.selectedText}>{selection.selectedText.slice(0, 50)}</span>
            <button type="button" onClick={() => { onPrompt?.('请根据以下文件内容回答：\n\n' + selection.selectedText) }}>引用</button>
            <button type="button" onClick={() => { void navigator.clipboard.writeText(selection.selectedText).catch(reason => setSaveError(String(reason))) }}>复制</button>
            {editable && <><button type="button" onClick={() => { setMode('replace'); startEditing() }}>修改</button>
              <button type="button" onClick={() => { setMode('insert'); startEditing(); setDraft('') }}>插入</button></>}
            {transformPreview && (['polish', 'expand', 'shorten'] as const).map((action, index) => <button key={action} type="button" disabled={modelBusy} onClick={() => { void transform(action) }}>{['润色', '扩写', '缩写'][index]}</button>)}
            {transformPreview && extension === 'docx' && (['pie', 'bar', 'line'] as const).map((action, index) => <button key={action} type="button" disabled={modelBusy} onClick={() => { void transform(action) }}>{['饼图', '柱状图', '折线图'][index]}</button>)}
            {modelBusy && <span role="status">正在生成编辑草稿…</span>}
            <button type="button" aria-label="关闭选区工具" onClick={() => setSelection(undefined)}>×</button>
          </div>}
        </div>
      </section>}
      <section className="buddy-workspace-tree">
        <header><span>工作区文件</span><button type="button" aria-label="新建文件" onClick={() => setOperation({ parts: [], action: 'create-file', name: '' })}>＋</button><button type="button" aria-label="新建文件夹" onClick={() => setOperation({ parts: [], action: 'create-directory', name: '' })}>▱</button><button type="button" aria-label="刷新文件" disabled={editing} onClick={() => setRevision(value => value + 1)}>↻</button><button type="button" aria-label="关闭文件栏" onClick={() => setOpen(false)}>×</button></header>
        {!editing && workspacePicker}
        <input aria-label="搜索工作区文件" placeholder="搜索工作区文件" value={search} onChange={event => setSearch(event.target.value)} />
        {listError && <p role="status">{listError}</p>}
        <ul>{rows.map((entry) => {
          const parts = entry.parts
          const path = parts.join('/')
          const isExpanded = expanded.some(value => value.join('/') === path)
          return <li key={path}><button type="button" title={path} draggable={!entry.directory}
            onContextMenu={(event) => { event.preventDefault(); setOperationError(''); setOperation({ parts, action: 'menu', name: entry.name }) }}
            style={{ paddingInlineStart: search ? 6 : 6 + (parts.length - 1) * 12 }}
            aria-expanded={entry.directory ? Boolean(search) || isExpanded : undefined}
            aria-current={file?.join('/') === path ? 'true' : undefined}
            onPointerDown={(event) => {
              suppressClick.current = false
              if (event.button !== 0) return
              pointer.current = { x: event.clientX, y: event.clientY }
              event.currentTarget.setPointerCapture?.(event.pointerId)
            }}
            onPointerMove={(event) => {
              const start = pointer.current
              if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 5) {
                setDragGhost({ x: event.clientX, y: event.clientY, name: entry.name })
              }
            }}
            onPointerCancel={() => { pointer.current = undefined; setDragGhost(undefined) }}
            onPointerUp={(event) => {
              const start = pointer.current
              setDragGhost(undefined)
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
            }}><WorkspaceFileIcon name={entry.name} directory={entry.directory} expanded={isExpanded} />
            {search ? path : entry.name}</button></li>
        })}</ul>
      </section>
      {operation && <div className="buddy-workspace-file-dialog" role="dialog" aria-modal="true" aria-label="工作区文件操作">
        {operation.action === 'menu' ? <><strong>{operation.name}</strong>
          <button type="button" onClick={() => setOperation({ ...operation, action: 'rename' })}>重命名</button>
          <button type="button" onClick={() => setOperation({ ...operation, action: 'delete' })}>删除</button>
          <button type="button" onClick={() => setOperation({ parts: rows.find(row => row.parts.join('/') === operation.parts.join('/'))?.directory ? operation.parts : operation.parts.slice(0, -1), action: 'create-file', name: '' })}>新建文件</button>
          <button type="button" onClick={() => setOperation({ parts: rows.find(row => row.parts.join('/') === operation.parts.join('/'))?.directory ? operation.parts : operation.parts.slice(0, -1), action: 'create-directory', name: '' })}>新建文件夹</button></>
          : <><strong>{operation.action === 'delete' ? '确认删除？文件将移至工作区的 .buddy-trash 文件夹。' : operation.action === 'rename' ? '重命名' : '新建'}</strong>
            {operation.action !== 'delete' && <input aria-label="文件名称" value={operation.name} onChange={event => setOperation({ ...operation, name: event.target.value })} />}
            <button type="button" disabled={saving || operation.action !== 'delete' && !operation.name.trim()} onClick={() => {
              setSaving(true); setOperationError('')
              void invoke('mutate_workspace_preview', { root, ...operation }).then(() => {
                if (operation.action === 'rename' || operation.action === 'delete') {
                  const prefix = operation.parts.join('/')
                  const affected = (parts: string[]) => parts.join('/') === prefix || parts.join('/').startsWith(prefix + '/')
                  if (operation.action === 'rename') {
                    const renamed = (parts: string[]) => affected(parts)
                      ? [...operation.parts.slice(0, -1), operation.name, ...parts.slice(operation.parts.length)] : parts
                    memory.current.drafts = new Map([...memory.current.drafts].map(([path, value]) => [renamed(path.split('/')).join('/'), value]))
                    setTabs(previous => previous.map(renamed)); setExpanded(previous => previous.map(renamed))
                    if (file && affected(file)) acceptFile(renamed(file))
                  } else {
                    memory.current.drafts = new Map([...memory.current.drafts].filter(([path]) => !affected(path.split('/'))))
                    setTabs(previous => previous.filter(parts => !affected(parts)))
                    if (file && affected(file)) {
                      setFile(undefined); setOriginal(undefined); setDraft(undefined); setBinaryDraft(undefined)
                    }
                  }
                }
                setOperation(undefined); setRevision(value => value + 1)
              }).catch(reason => setOperationError(String(reason))).finally(() => setSaving(false))
            }}>确认</button></>}
        {operationError && <p role="alert">{operationError}</p>}
        <button type="button" disabled={saving} onClick={() => setOperation(undefined)}>取消</button>
      </div>}
    </aside>, document.body)}
  </>
}
