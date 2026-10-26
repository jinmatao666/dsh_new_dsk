import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  citationLocateHint,
  splitAnswerCitations,
  type KnowledgeCitation,
} from './citations.ts'
import { MarkdownView } from './MarkdownView.tsx'
import { PdfLocateViewer, type PdfLocateRequest } from './PdfLocateViewer.tsx'
import { ViewerLoading } from './ViewerLoading.tsx'
import { firstNavLibraryId, libraryNavGroups } from './library-groups.ts'
import { productText } from './locales/product.ts'

export interface KnowledgeBaseItem {
  id: number
  name: string
  description: string
  kind: 'personal' | 'shared' | 'common'
  owner_user_id: number
  /** Workbench category that owns this library. Absent or 0 means a built-in tab. */
  category_id?: number
}

/** Administrator-defined category. Open categories may appear after Personal; auth-required ones feed the plaza and 订阅知识库. */
export interface KnowledgeCategory {
  id: number
  name: string
  type: 'personal' | 'shared' | 'common'
  require_auth: boolean
}

/** Marketplace card for an auth-required category library. */
export interface KnowledgePlazaItem {
  id: number
  name: string
  description: string
  kind: 'personal' | 'shared' | 'common'
  owner_user_id: number
  category_id: number
  category_name: string
  owner_username: string
  subscription_status: 'none' | 'pending' | 'approved'
}

interface KnowledgeDocument {
  id: string
  name: string
  /** Relative storage path when the file was uploaded from a folder. */
  location?: string
  size: number
  run: string
  progress: number
  create_time?: number
  update_time?: number
}

type ContentNode =
  | { type: 'folder'; path: string; name: string; children: ContentNode[] }
  | { type: 'file'; document: KnowledgeDocument }

interface KnowledgeChunk {
  id: string
  content: string
}

interface KnowledgeAnswer {
  answer: string
  recommendations: string[]
  citations?: KnowledgeCitation[]
}

/** Progressive answer updates while the Host streams a completion. */
export interface KnowledgeAnswerProgress {
  answer: string
  recommendations?: string[]
  citations?: KnowledgeCitation[]
  done: boolean
}

interface KnowledgeFileBytes {
  contentType: string
  bytes: number[]
}

type Message = {
  role: 'user' | 'assistant'
  content: string
  recommendations?: string[]
  citations?: KnowledgeCitation[]
}

/** Conflict handling when the destination already has the same file name. */
export type KnowledgeConflictPolicy = 'keep' | 'replace'

/** Authenticated knowledge operations supplied by the Host. */
export interface KnowledgeApi {
  list(): Promise<KnowledgeBaseItem[]>
  /** Categories in workbench order; each becomes a sidebar group after Personal. */
  categories(): Promise<KnowledgeCategory[]>
  /** Marketplace libraries from auth-required categories. */
  plaza(input?: { categoryId?: number; keyword?: string }): Promise<KnowledgePlazaItem[]>
  /** One marketplace library detail for the subscribe screen. */
  plazaItem(id: number): Promise<KnowledgePlazaItem>
  /** Marketplace document catalog for one plaza library (names and folders only). */
  plazaDocuments(id: number): Promise<KnowledgeDocument[]>
  /** Submit a subscription application for an auth-required category library. */
  subscribe(id: number): Promise<void>
  /** Drop the caller's grant so the library returns to the plaza. */
  unsubscribe(id: number): Promise<void>
  create(value: { name: string; description: string; kind: 'personal' }): Promise<KnowledgeBaseItem>
  documents(id: number): Promise<KnowledgeDocument[]>
  /** Load parsed document text for the desktop viewer. */
  chunks(knowledgeBaseId: number, documentId: string): Promise<KnowledgeChunk[]>
  /** Download the original file bytes for the desktop viewer. */
  download(knowledgeBaseId: number, documentId: string): Promise<KnowledgeFileBytes>
  upload(id: number, file: File): Promise<void>
  /** Remove one document from the authorized library through RAGFlow. */
  delete(knowledgeBaseId: number, documentId: string): Promise<void>
  /** Copy one document into another personal or shared library. */
  copy(
    knowledgeBaseId: number,
    documentId: string,
    targetId: number,
    conflictPolicy?: KnowledgeConflictPolicy,
  ): Promise<void>
  /** Move one document into another personal or shared library. */
  move(
    knowledgeBaseId: number,
    documentId: string,
    targetId: number,
    conflictPolicy?: KnowledgeConflictPolicy,
  ): Promise<void>
  /** Load the caller's saved Q&A turns for one authorized knowledge base. */
  messages(knowledgeBaseId: number): Promise<Message[]>
  /**
   * Ask the authorized knowledge base through its server-owned chat/completions session.
   * @param onProgress - Optional cumulative plain-text updates while the answer streams.
   * @param signal - Optional abort signal for stop-while-answering.
   */
  complete(
    knowledgeBaseId: number,
    question: string,
    onProgress?: (progress: KnowledgeAnswerProgress) => void,
    signal?: AbortSignal,
  ): Promise<KnowledgeAnswer>
}

type DocumentMenu = { documentId: string; x: number; y: number }
type TransferMode = 'copy' | 'move'
type TransferState = {
  mode: TransferMode
  documentIds: string[]
  targetId?: number | undefined
  remaining: number
  busy: boolean
}
type ConflictState = {
  names: string[]
  resolve: (policy: KnowledgeConflictPolicy | 'cancel') => void
}

type DocumentViewer = {
  document: KnowledgeDocument
  loading: boolean
  mode: 'image' | 'pdf' | 'text'
  objectUrl?: string
  pdfBytes?: Uint8Array
  content?: string
  /** Render downloaded text as Markdown when the file is .md. */
  markdown?: boolean
  locate?: PdfLocateRequest
}

const CONTENT_MIN = 260
const CONTENT_DEFAULT = 400
const CHAT_MIN = 180
const SPLIT_WIDTH = 8

function contentSpan(box: DOMRect | undefined): { nav: number; max: number } {
  const width = box !== undefined && box.width > 0 ? box.width : 1200
  const nav = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 980px)').matches ? 180 : 210
  return { nav, max: Math.max(CONTENT_MIN, Math.floor(width - nav - CHAT_MIN - SPLIT_WIDTH)) }
}

/** Render the three-pane knowledge library and its isolated RAGFlow conversation.
 * @param props - Host-owned API implementation.
 * @returns Knowledge-base page.
 */
export function KnowledgePage({ api }: { api: KnowledgeApi }) {
  const [items, setItems] = useState<KnowledgeBaseItem[]>([])
  const [categories, setCategories] = useState<KnowledgeCategory[]>([])
  const [selectedId, setSelectedId] = useState<number>()
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [plazaOpen, setPlazaOpen] = useState(false)
  const [plazaItems, setPlazaItems] = useState<KnowledgePlazaItem[]>([])
  const [plazaDetail, setPlazaDetail] = useState<KnowledgePlazaItem>()
  const [plazaQuery, setPlazaQuery] = useState('')
  const [plazaLoading, setPlazaLoading] = useState(false)
  const [plazaDocuments, setPlazaDocuments] = useState<KnowledgeDocument[]>([])
  const [plazaFolders, setPlazaFolders] = useState<Set<string>>(new Set())
  const [subscribing, setSubscribing] = useState(false)
  const [unsubscribing, setUnsubscribing] = useState(false)
  const [createKind, setCreateKind] = useState<'personal'>()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [answering, setAnswering] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [newestFirst, setNewestFirst] = useState(true)
  const [contentWidth, setContentWidth] = useState(CONTENT_DEFAULT)
  const [contentLimit, setContentLimit] = useState(1200)
  const [resizing, setResizing] = useState(false)
  const [viewer, setViewer] = useState<DocumentViewer>()
  const [previewAskOpen, setPreviewAskOpen] = useState(false)
  const [previewQuestion, setPreviewQuestion] = useState('')
  const [previewMessages, setPreviewMessages] = useState<Message[]>([])
  const [previewHints, setPreviewHints] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([])
  const [documentMenu, setDocumentMenu] = useState<DocumentMenu>()
  const [transfer, setTransfer] = useState<TransferState>()
  const [conflict, setConflict] = useState<ConflictState>()
  const [deleteIds, setDeleteIds] = useState<string[]>()
  const [mutating, setMutating] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set())
  const [collapsedNavGroups, setCollapsedNavGroups] = useState<Set<string>>(() => new Set())
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const uploadRoot = useRef<HTMLDivElement>(null)
  const layout = useRef<HTMLElement>(null)
  const messagesPane = useRef<HTMLDivElement>(null)
  const previewMessagesPane = useRef<HTMLDivElement>(null)
  const previewBodyRef = useRef<HTMLDivElement>(null)
  const answerAbort = useRef<AbortController>()
  const historyEpoch = useRef(0)
  const viewerRef = useRef<DocumentViewer>()
  viewerRef.current = viewer

  const selected = items.find(item => item.id === selectedId)
  const selfUserId = items.find(item => item.kind === 'personal')?.owner_user_id
  const selectedIsSubscribed = selected !== undefined
    && (selfUserId === undefined || selected.owner_user_id !== selfUserId)
    && categories.some(category =>
      category.require_auth && category.id === (selected.category_id ?? 0))
  // Stick to the latest turn only while an answer is streaming; history opens at the top.
  useEffect(() => {
    if (!answering) return
    const pane = previewAskOpen ? previewMessagesPane.current : messagesPane.current
    if (pane === null) return
    pane.scrollTop = pane.scrollHeight
  }, [messages, previewMessages, answering, previewAskOpen])
  useEffect(() => {
    const quote = viewer?.locate?.quote?.trim() ?? ''
    if (viewer === undefined || viewer.loading || viewer.mode === 'pdf' || quote === '') return
    const root = previewBodyRef.current
    if (root === null) return
    const needle = quote.replace(/\s+/g, '').slice(0, 24)
    if (needle.length < 2) return
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node !== null) {
      const text = node.textContent?.replace(/\s+/g, '') ?? ''
      if (text.includes(needle) && node.parentElement !== null) {
        node.parentElement.scrollIntoView({ block: 'center' })
        return
      }
      node = walker.nextNode()
    }
  }, [viewer?.locate, viewer?.loading, viewer?.mode])
  useEffect(() => {
    const input = folderInput.current
    if (input === null) return
    // Directory mode is not typed on HTMLInputElement; set it on the DOM node.
    input.setAttribute('webkitdirectory', '')
    input.setAttribute('directory', '')
    input.multiple = true
  }, [])
  useEffect(() => {
    let disposed = false
    Promise.all([api.list(), api.categories()]).then(([result, nextCategories]) => {
      if (disposed) return
      setItems(result)
      setCategories(nextCategories)
      setSelectedId(firstNavLibraryId(result, nextCategories))
      setPlazaOpen(false)
      setCollapsedNavGroups(new Set())
    }).catch((cause) => { if (!disposed) setError(`${productText('加载失败')}：${String(cause)}`) })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [api])
  const refreshPlaza = async (keyword?: string) => {
    setPlazaLoading(true)
    setError('')
    try {
      const rows = await api.plaza({
        ...(keyword !== undefined && keyword.trim() !== '' ? { keyword: keyword.trim() } : {}),
      })
      setPlazaItems(rows.filter(item => item.subscription_status !== 'approved'))
    } catch (cause) {
      setError(`${productText('加载失败')}：${String(cause)}`)
    } finally {
      setPlazaLoading(false)
    }
  }
  const openPlaza = () => {
    setPlazaOpen(true)
    setPlazaDetail(undefined)
    setPlazaQuery('')
    void refreshPlaza()
  }
  const openPlazaItem = async (id: number) => {
    setPlazaLoading(true)
    setError('')
    setPlazaDocuments([])
    setPlazaFolders(new Set())
    try {
      const [detail, documents] = await Promise.all([
        api.plazaItem(id),
        api.plazaDocuments(id).catch(() => [] as KnowledgeDocument[]),
      ])
      setPlazaDetail(detail)
      setPlazaDocuments(documents)
    } catch (cause) {
      setError(`${productText('加载失败')}：${String(cause)}`)
    } finally {
      setPlazaLoading(false)
    }
  }
  const submitSubscribe = async () => {
    if (plazaDetail === undefined || subscribing) return
    if (plazaDetail.subscription_status !== 'none') return
    setSubscribing(true)
    setError('')
    try {
      await api.subscribe(plazaDetail.id)
      const next = { ...plazaDetail, subscription_status: 'pending' as const }
      setPlazaDetail(next)
      setPlazaItems(current => current.map(item => item.id === next.id ? next : item))
    } catch (cause) {
      setError(`${productText('订阅失败')}：${String(cause)}`)
    } finally {
      setSubscribing(false)
    }
  }
  const reloadLibraries = async () => {
    const [result, nextCategories] = await Promise.all([api.list(), api.categories()])
    setItems(result)
    setCategories(nextCategories)
    setSelectedId((current) => {
      if (current !== undefined && result.some(item => item.id === current)) return current
      return firstNavLibraryId(result, nextCategories)
    })
  }
  const submitUnsubscribe = async () => {
    if (selectedId === undefined || unsubscribing || !selectedIsSubscribed) return
    setUnsubscribing(true)
    setError('')
    try {
      await api.unsubscribe(selectedId)
      await reloadLibraries()
    } catch (cause) {
      setError(`${productText('取消订阅失败')}：${String(cause)}`)
    } finally {
      setUnsubscribing(false)
    }
  }
  useEffect(() => {
    if (selectedId === undefined) {
      setDocuments([])
      setMessages([])
      setSelectedDocumentIds([])
      setDocumentMenu(undefined)
      return
    }
    let disposed = false
    const epoch = ++historyEpoch.current
    setMessages([])
    setSelectedDocumentIds([])
    setDocumentMenu(undefined)
    api.documents(selectedId).then((value) => {
      if (disposed) return
      setDocuments(value)
      setExpandedFolders(topLevelFolderPaths(value))
    })
      .catch((cause) => { if (!disposed) setError(`${productText('加载失败')}：${String(cause)}`) })
    api.messages(selectedId).then((value) => {
      if (!disposed && historyEpoch.current === epoch) setMessages(value)
    }).catch((cause) => {
      if (disposed || historyEpoch.current !== epoch) return
      setMessages([])
      setError(`${productText('加载失败')}：${String(cause)}`)
    })
    return () => { disposed = true }
  }, [api, selectedId])
  useEffect(() => {
    if (documentMenu === undefined) return
    const close = () => setDocumentMenu(undefined)
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [documentMenu])
  const transferTargets = items.filter(item =>
    (item.kind === 'personal' || item.kind === 'shared') && item.id !== selectedId)
  const navGroups = libraryNavGroups(items, categories)
  /** Toggle multi-select without opening preview or the action panel. */
  const toggleDocumentSelection = (documentId: string) => {
    setDocumentMenu(undefined)
    setSelectedDocumentIds((current) => {
      return current.includes(documentId)
        ? current.filter(id => id !== documentId)
        : [...current, documentId]
    })
  }
  /** Select the document (keeping multi-select if already included) and show the action panel. */
  const openDocumentMenu = (documentId: string, x: number, y: number) => {
    setSelectedDocumentIds(current => current.includes(documentId) ? current : [documentId])
    setDocumentMenu({ documentId, x, y })
  }
  const askConflict = (names: string[]) => new Promise<KnowledgeConflictPolicy | 'cancel'>((resolve) => {
    setConflict({ names, resolve })
  })
  const closeConflict = (policy: KnowledgeConflictPolicy | 'cancel') => {
    setConflict((current) => {
      current?.resolve(policy)
      return undefined
    })
  }
  const refreshDocuments = async () => {
    if (selectedId === undefined) return
    setDocuments(await api.documents(selectedId))
  }
  const startTransfer = (mode: TransferMode) => {
    const documentIds = selectedDocumentIds.length > 0
      ? selectedDocumentIds
      : documentMenu === undefined ? [] : [documentMenu.documentId]
    setDocumentMenu(undefined)
    if (documentIds.length === 0) return
    setTransfer({
      mode, documentIds, remaining: documentIds.length, busy: false,
      targetId: transferTargets[0]?.id,
    })
  }
  const runTransfer = async (conflictPolicy?: KnowledgeConflictPolicy) => {
    if (selectedId === undefined || transfer === undefined || transfer.targetId === undefined || transfer.busy) return
    const targetId = transfer.targetId
    const mode = transfer.mode
    const documentIds = [...transfer.documentIds]
    setTransfer(current => current === undefined ? current : { ...current, busy: true, remaining: documentIds.length })
    setError('')
    try {
      const targetDocuments = await api.documents(targetId)
      const names = new Set(targetDocuments.map(document => document.name))
      const conflicts = documentIds
        .map(id => documents.find(document => document.id === id)?.name)
        .filter((name): name is string => typeof name === 'string' && names.has(name))
      let policy = conflictPolicy
      if (conflicts.length > 0 && policy === undefined) {
        setTransfer(current => current === undefined ? current : { ...current, busy: false })
        const choice = await askConflict([...new Set(conflicts)])
        if (choice === 'cancel') return
        policy = choice
        setTransfer(current => current === undefined ? current : { ...current, busy: true })
      }
      for (let index = 0; index < documentIds.length; index += 1) {
        const documentId = documentIds[index]
        if (documentId === undefined) continue
        setTransfer(current => current === undefined ? current : {
          ...current, remaining: documentIds.length - index,
        })
        if (mode === 'copy') await api.copy(selectedId, documentId, targetId, policy)
        else await api.move(selectedId, documentId, targetId, policy)
      }
      setTransfer(undefined)
      setSelectedDocumentIds([])
      await refreshDocuments()
    } catch (cause) {
      setError(`${productText(mode === 'copy' ? '复制失败' : '移动失败')}：${String(cause)}`)
      setTransfer(current => current === undefined ? current : { ...current, busy: false })
    }
  }
  const confirmDelete = async () => {
    if (selectedId === undefined || deleteIds === undefined || deleteIds.length === 0 || mutating) return
    setMutating(true)
    setError('')
    try {
      for (const documentId of deleteIds) await api.delete(selectedId, documentId)
      setDeleteIds(undefined)
      setSelectedDocumentIds([])
      closeViewer()
      await refreshDocuments()
    } catch (cause) {
      setError(`${productText('删除失败')}：${String(cause)}`)
    } finally {
      setMutating(false)
    }
  }
  const openCreate = (kind: 'personal') => {
    setCreateKind(kind)
    setName('')
    setDescription('')
    setError('')
  }
  const resetPreviewAsk = () => {
    setPreviewAskOpen(false)
    setPreviewQuestion('')
    setPreviewMessages([])
    setPreviewHints(true)
  }
  const closeViewer = () => {
    resetPreviewAsk()
    setViewer((current) => {
      if (current?.objectUrl !== undefined) URL.revokeObjectURL(current.objectUrl)
      return undefined
    })
  }
  const choose = (id: number) => {
    setSelectedId(id)
    setError('')
    closeViewer()
  }
  const openDocument = (document: KnowledgeDocument, locate?: PdfLocateRequest, keepAsk = false) => {
    if (selectedId === undefined) return
    if (!keepAsk) resetPreviewAsk()
    const kind = fileKind(document.name)
    const loadingMode: DocumentViewer['mode'] = kind === 'pdf' ? 'pdf' : kind === 'image' ? 'image' : 'text'
    setViewer((current) => {
      if (current?.objectUrl !== undefined) URL.revokeObjectURL(current.objectUrl)
      return {
        document, loading: true, mode: loadingMode, content: '',
        ...(locate === undefined ? {} : { locate }),
      }
    })
    setError('')
    void (async () => {
      const apply = (next: DocumentViewer, orphanUrl?: string) => {
        setViewer((current) => {
          if (current === undefined || current.document.id !== document.id) {
            if (orphanUrl !== undefined) URL.revokeObjectURL(orphanUrl)
            return current
          }
          return next
        })
      }
      try {
        if (kind === 'image' || kind === 'pdf' || isPlainTextName(document.name)) {
          const file = await api.download(selectedId, document.id)
          const bytes = Uint8Array.from(file.bytes)
          const contentType = mimeFor(document.name, file.contentType)
          if (kind === 'image' || contentType.startsWith('image/')) {
            const objectUrl = URL.createObjectURL(new Blob([bytes], { type: contentType }))
            apply({ document, loading: false, mode: 'image', objectUrl }, objectUrl)
            return
          }
          if (kind === 'pdf' || contentType.includes('pdf')) {
            apply({
              document, loading: false, mode: 'pdf', pdfBytes: bytes,
              ...(locate === undefined ? {} : { locate }),
            })
            return
          }
          apply({
            document, loading: false, mode: 'text',
            content: new TextDecoder('utf-8').decode(bytes),
            markdown: isMarkdownName(document.name),
          })
          return
        }
        const chunks = await api.chunks(selectedId, document.id)
        apply({
          document, loading: false, mode: 'text',
          content: chunks.map(chunk => chunk.content.trim()).filter(Boolean).join('\n\n'),
          markdown: isMarkdownName(document.name),
        })
      } catch (cause) {
        setViewer((current) => {
          if (current === undefined || current.document.id !== document.id) return current
          if (current.objectUrl !== undefined) URL.revokeObjectURL(current.objectUrl)
          return undefined
        })
        setError(`${productText('打开失败')}：${String(cause)}`)
      }
    })()
  }
  const citationLocate = (citation: KnowledgeCitation, answerHint = ''): PdfLocateRequest => ({
    ...(citation.page !== undefined ? { page: citation.page } : {}),
    ...(citation.quote !== '' ? { quote: citation.quote } : {}),
    ...(answerHint.trim() !== '' ? { hint: answerHint.trim() } : {}),
    ...(citation.positions !== undefined && citation.positions.length > 0
      ? { positions: citation.positions }
      : {}),
  })
  const openCitation = (citation: KnowledgeCitation, answerHint = '') => {
    const document = documents.find(item => item.id === citation.document_id)
      ?? {
        id: citation.document_id,
        name: citation.document_name || citation.document_id,
        size: 0,
        run: 'DONE',
        progress: 1,
      }
    openDocument(document, citationLocate(citation, answerHint))
  }
  const locateInPreview = (citation: KnowledgeCitation, answerHint = '') => {
    const request = citationLocate(citation, answerHint)
    const current = viewerRef.current
    const sameDocument = current !== undefined && !current.loading && (
      current.document.id === citation.document_id
      || documentDisplayName(current.document) === citation.document_name
    )
    if (sameDocument) {
      setViewer(open => open === undefined ? open : { ...open, locate: request })
      return
    }
    const document = documents.find(item => item.id === citation.document_id)
      ?? {
        id: citation.document_id,
        name: citation.document_name || citation.document_id,
        size: 0,
        run: 'DONE',
        progress: 1,
      }
    openDocument(document, request, true)
  }
  const downloadDocument = async () => {
    if (selectedId === undefined || viewer === undefined || downloading) return
    setDownloading(true)
    try {
      const file = await api.download(selectedId, viewer.document.id)
      const url = URL.createObjectURL(new Blob([Uint8Array.from(file.bytes)], {
        type: mimeFor(viewer.document.name, file.contentType),
      }))
      const link = window.document.createElement('a')
      link.href = url
      link.download = documentDisplayName(viewer.document) || 'download'
      link.click()
      URL.revokeObjectURL(url)
    } catch (cause) {
      setError(`${productText('下载失败')}：${String(cause)}`)
    } finally {
      setDownloading(false)
    }
  }
  useEffect(() => () => {
    const url = viewerRef.current?.objectUrl
    if (url !== undefined) URL.revokeObjectURL(url)
  }, [])
  const submitCreate = async (event: FormEvent) => {
    event.preventDefault()
    if (createKind === undefined || name.trim() === '') return
    setSaving(true)
    try {
      const created = await api.create({ name: name.trim(), description: description.trim(), kind: createKind })
      setItems(current => [created, ...current])
      choose(created.id)
      setCreateKind(undefined)
      setName('')
      setDescription('')
    } catch (cause) {
      setError(`${productText('创建失败')}：${String(cause)}`)
    } finally {
      setSaving(false)
    }
  }
  useEffect(() => {
    if (!uploadOpen) return
    const close = (event: MouseEvent) => {
      if (!uploadRoot.current?.contains(event.target as Node)) setUploadOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [uploadOpen])
  const uploadFiles = async (files: File[]) => {
    if (selectedId === undefined) return
    // Folder picks arrive as a flat FileList of every nested file; upload each into the open library.
    const candidates = files.filter(file => !isSkippedUploadName(file.name))
    if (candidates.length === 0) return
    const oversized = candidates.find(file => file.size > 20 * 1024 * 1024)
    if (oversized !== undefined) {
      setError(productText('文件不能超过 20MB'))
      return
    }
    setUploading(true)
    setError('')
    try {
      for (const file of candidates) await api.upload(selectedId, file)
      const next = await api.documents(selectedId)
      setDocuments(next)
      setExpandedFolders((current) => {
        const merged = new Set(current)
        for (const path of topLevelFolderPaths(next)) merged.add(path)
        for (const file of candidates) {
          const relative = typeof file.webkitRelativePath === 'string' ? file.webkitRelativePath.replace(/\\/g, '/') : ''
          const slash = relative.lastIndexOf('/')
          if (slash <= 0) continue
          let prefix = ''
          for (const part of relative.slice(0, slash).split('/')) {
            if (part === '') continue
            prefix = prefix === '' ? part : `${prefix}/${part}`
            merged.add(prefix)
          }
        }
        return merged
      })
    } catch (cause) {
      setError(`${productText('上传失败')}：${String(cause)}`)
    } finally {
      setUploading(false)
    }
  }
  const takeFiles = (input: HTMLInputElement) => {
    const files = [...(input.files ?? [])]
    input.value = ''
    void uploadFiles(files)
  }
  const shownDocuments = documents.filter((document) => {
    if (query.trim() === '') return true
    const needle = query.trim().toLowerCase()
    return documentDisplayName(document).toLowerCase().includes(needle)
      || documentStoragePath(document).toLowerCase().includes(needle)
  })
  const contentTree = buildContentTree(shownDocuments, newestFirst)
  const searching = query.trim() !== ''
  const toggleFolder = (path: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  const stopAnswer = () => {
    answerAbort.current?.abort()
  }
  const writeAnswer = (
    write: typeof setMessages,
    progress: { answer: string; recommendations?: string[]; citations?: KnowledgeCitation[] },
  ) => {
    write((current) => {
      if (current.length === 0) return current
      const next = [...current]
      const last = next[next.length - 1]
      if (last === undefined || last.role !== 'assistant') return current
      const emptyHit = /知识库中未找到相关内容/.test(progress.answer)
      next[next.length - 1] = {
        role: 'assistant',
        content: progress.answer,
        ...(progress.recommendations !== undefined ? { recommendations: progress.recommendations } : {}),
        ...(emptyHit
          ? { citations: [] }
          : progress.citations !== undefined ? { citations: progress.citations } : {}),
      }
      return next
    })
  }
  const submitKnowledgeQuestion = async (raw: string, sink: 'library' | 'preview') => {
    let text = raw.trim()
    if (text === '' || selectedId === undefined || answering) return
    let targetKnowledgeBaseId = selectedId
    if (sink === 'library') {
      const mention = /^@(\S+)\s+/.exec(text)
      const mentioned = mention === null ? undefined : items.find(item => item.name === mention[1])
      targetKnowledgeBaseId = mentioned?.id ?? selectedId
      if (mentioned !== undefined && mention !== null) text = text.slice(mention[0].length)
      if (text === '') return
    }
    const write = sink === 'library' ? setMessages : setPreviewMessages
    answerAbort.current?.abort()
    const abort = new AbortController()
    answerAbort.current = abort
    historyEpoch.current += 1
    if (sink === 'library') setQuestion('')
    else {
      setPreviewQuestion('')
      setPreviewHints(false)
    }
    write(current => [...current, { role: 'user', content: text }, { role: 'assistant', content: '' }])
    setAnswering(true)
    try {
      const answer = await api.complete(targetKnowledgeBaseId, text, (progress) => {
        writeAnswer(write, progress)
      }, abort.signal)
      writeAnswer(write, {
        answer: answer.answer,
        recommendations: answer.recommendations,
        ...(answer.citations !== undefined && answer.citations.length > 0 ? { citations: answer.citations } : {}),
      })
    } catch (cause) {
      const aborted = abort.signal.aborted
        || (cause instanceof DOMException && cause.name === 'AbortError')
        || (cause instanceof Error && cause.name === 'AbortError')
      write((current) => {
        if (current.length === 0) return current
        const last = current[current.length - 1]
        if (last?.role === 'assistant' && last.content === '') return current.slice(0, -1)
        return current
      })
      if (!aborted) setError(`${productText('对话失败')}：${String(cause)}`)
    } finally {
      if (answerAbort.current === abort) answerAbort.current = undefined
      setAnswering(false)
    }
  }
  const ask = (event: FormEvent) => {
    event.preventDefault()
    void submitKnowledgeQuestion(question, 'library')
  }
  const askPreview = (event: FormEvent) => {
    event.preventDefault()
    if (viewer === undefined) return
    const fileName = documentDisplayName(viewer.document)
    const typed = previewQuestion.trim()
    if (typed === '') return
    // Keep the user question first so retrieval embeds the real ask, not the file wrapper.
    void submitKnowledgeQuestion(
      `${typed}\n请依据文件「${fileName}」中的内容完整作答；相关分项或编号列表须全部列出。`,
      'preview',
    )
  }
  const askPreviewPrompt = (prompt: string) => {
    void submitKnowledgeQuestion(prompt, 'preview')
  }
  const applyContentWidth = (target: number) => {
    const span = contentSpan(layout.current?.getBoundingClientRect())
    setContentLimit(span.max)
    setContentWidth(Math.round(Math.min(Math.max(target, CONTENT_MIN), span.max)))
  }
  const resizeContent = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const move = (moveEvent: globalThis.PointerEvent) => {
      const box = layout.current?.getBoundingClientRect()
      if (box === undefined) return
      applyContentWidth(moveEvent.clientX - box.left - contentSpan(box).nav)
    }
    const end = () => {
      setResizing(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    setResizing(true)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }
  const nudgeContent = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      applyContentWidth(contentWidth + step)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      applyContentWidth(contentWidth - step)
    }
  }

  return <section ref={layout} className={resizing ? 'dsh-knowledge resizing' : 'dsh-knowledge'}
    style={{ '--dsh-knowledge-content-width': `${contentWidth}px` } as CSSProperties}>
    <aside className="dsh-knowledge-nav">
      <div className="dsh-knowledge-nav-groups">
        {navGroups.map((group) => {
          const expanded = !collapsedNavGroups.has(group.key)
          return <div key={group.key} className="dsh-knowledge-group">
            <div className="dsh-knowledge-group-head">
              <button type="button" className="dsh-knowledge-group-toggle"
                aria-expanded={expanded}
                aria-label={`${expanded ? productText('收起') : productText('展开')}${group.label}`}
                onClick={() => setCollapsedNavGroups((current) => {
                  const next = new Set(current)
                  if (next.has(group.key)) next.delete(group.key)
                  else next.add(group.key)
                  return next
                })}>
                <span className={expanded ? 'dsh-knowledge-group-chevron open' : 'dsh-knowledge-group-chevron'}
                  aria-hidden="true"><ChevronIcon /></span>
                <strong>{group.label}</strong>
              </button>
              {group.createLabel !== undefined && group.create === 'personal' &&
                <button type="button" aria-label={group.createLabel}
                  onClick={() => openCreate('personal')}>
                  <PlusIcon />
                </button>}
            </div>
            {expanded && group.rows.map(item =>
              <button type="button" className={item.id === selectedId ? 'active' : ''} key={item.id}
                onClick={() => { setPlazaOpen(false); choose(item.id) }}>
                <span className="dsh-knowledge-nav-icon" aria-hidden="true"><LibraryFolderIcon /></span>{item.name}
              </button>)}
          </div>
        })}
      </div>
      <button type="button" className="dsh-knowledge-plaza-launch" onClick={() => openPlaza()}>
        {productText('知识库广场')} <span aria-hidden="true">»</span>
      </button>
    </aside>
    {plazaOpen && <div className="dsh-knowledge-plaza" role="region" aria-label={productText('知识库广场')}>
      <header className="dsh-knowledge-plaza-head">
        <button type="button" className="dsh-knowledge-back" aria-label={productText('返回')}
          onClick={() => {
            if (plazaDetail !== undefined) {
              setPlazaDetail(undefined)
              setPlazaDocuments([])
              setPlazaFolders(new Set())
              return
            }
            setPlazaOpen(false)
            void reloadLibraries().catch(cause => setError(`${productText('加载失败')}：${String(cause)}`))
          }}>
          <BackIcon />
        </button>
        <h2>
          <span className="dsh-knowledge-plaza-title-mark" aria-hidden="true"><PlazaMarkIcon /></span>
          {plazaDetail === undefined ? productText('知识库广场') : plazaDetail.name}
        </h2>
        {plazaDetail === undefined &&
          <label className="dsh-knowledge-plaza-search">
            <SearchIcon />
            <input value={plazaQuery} onChange={event => setPlazaQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                void refreshPlaza(plazaQuery)
              }}
              placeholder={productText('搜索知识库')} />
          </label>}
      </header>
      {plazaDetail === undefined ? <>
        {plazaLoading ? <p role="status">{productText('正在加载…')}</p>
          : plazaItems.length === 0 ? <p className="dsh-knowledge-empty">{productText('暂无可订阅知识库')}</p>
            : <div className="dsh-knowledge-plaza-grid">
              {plazaItems.map(item =>
                <button type="button" key={item.id} className="dsh-knowledge-plaza-card"
                  onClick={() => void openPlazaItem(item.id)}>
                  <span className="dsh-knowledge-plaza-cover" aria-hidden="true"><PlazaCoverIcon seed={item.id} /></span>
                  <span className="dsh-knowledge-plaza-card-body">
                    <strong>{item.name}</strong>
                    <p>{item.description || productText('暂无描述')}</p>
                    <small>
                      <span>@{item.owner_username || productText('未知作者')}</span>
                      {item.category_name !== '' && <span>· {item.category_name}</span>}
                    </small>
                  </span>
                </button>)}
            </div>}
        <p className="dsh-knowledge-hint">{productText('订阅后需管理员审核，通过后会出现在左侧订阅知识库；已订阅的知识库不再出现在广场。')}</p>
      </> : <div className="dsh-knowledge-plaza-detail">
        <div className="dsh-knowledge-plaza-detail-main">
          <span className="dsh-knowledge-plaza-cover large" aria-hidden="true">
            <PlazaCoverIcon seed={plazaDetail.id} />
          </span>
          <div className="dsh-knowledge-plaza-detail-copy">
            <h3>{plazaDetail.name}</h3>
            <p className="dsh-knowledge-plaza-owner">
              @{plazaDetail.owner_username || productText('未知作者')}
              {plazaDetail.category_name !== '' && <span> · {plazaDetail.category_name}</span>}
            </p>
            <p>{plazaDetail.description || productText('暂无描述')}</p>
          </div>
          <button type="button" className="dsh-knowledge-plaza-subscribe"
            disabled={subscribing || plazaDetail.subscription_status !== 'none'}
            onClick={() => void submitSubscribe()}>
            {plazaDetail.subscription_status === 'approved' ? productText('已订阅')
              : plazaDetail.subscription_status === 'pending' ? productText('审核中')
                : productText('订阅')}
          </button>
        </div>
        <div className="dsh-knowledge-plaza-content">
          <div className="dsh-knowledge-plaza-content-tabs">
            <strong>{productText('内容')}{plazaDocuments.length > 0 ? ` ${plazaDocuments.length}` : ''}</strong>
          </div>
          {plazaDocuments.length === 0
            ? <p className="dsh-knowledge-empty">{productText('暂无内容')}</p>
            : <div className="dsh-knowledge-plaza-files" role="list">
              {renderPlazaContentTree(buildContentTree(plazaDocuments, true), {
                depth: 0,
                expandedFolders: plazaFolders,
                onToggleFolder: path => setPlazaFolders((current) => {
                  const next = new Set(current)
                  if (next.has(path)) next.delete(path)
                  else next.add(path)
                  return next
                }),
              })}
            </div>}
        </div>
        <p className="dsh-knowledge-hint">{productText('订阅后需管理员审核，通过后会出现在左侧订阅知识库；已订阅的知识库不再出现在广场。')}</p>
      </div>}
    </div>}
    <main className={uploadOpen ? 'dsh-knowledge-content upload-open' : 'dsh-knowledge-content'}>
      <header>
        <div className="dsh-knowledge-cover" aria-hidden="true">
          {selected === undefined ? <BookIcon />
            : <LibraryFolderIcon />}
        </div>
        <div className="dsh-knowledge-header-copy">
          <h2>{selected?.name ?? productText('暂无知识库')}</h2>
          <p>{selected?.description ?? ''}</p>
        </div>
        {selectedIsSubscribed &&
          <button type="button" className="dsh-knowledge-unsubscribe" disabled={unsubscribing}
            onClick={() => void submitUnsubscribe()}>
            {productText('取消订阅')}
          </button>}
      </header>
      <div className="dsh-knowledge-toolbar">
        <strong>{productText('内容')}({documents.length})</strong>
        <div className="dsh-knowledge-toolbar-actions">
          <button type="button" aria-label={productText('搜索内容')} aria-pressed={searchOpen} onClick={() => setSearchOpen(value => !value)}><SearchIcon /></button>
          <button type="button" aria-label={productText('排序')} aria-pressed={newestFirst} onClick={() => setNewestFirst(value => !value)}><SortIcon /></button>
          <div className="dsh-knowledge-upload" ref={uploadRoot}>
            <button type="button" aria-label={uploading ? productText('正在加载…') : productText('上传文档')}
              aria-expanded={uploadOpen} aria-haspopup="menu" aria-busy={uploading}
              disabled={selectedId === undefined || uploading} onClick={() => setUploadOpen(value => !value)}>
              {uploading ? <span className="dsh-knowledge-upload-busy" aria-hidden="true" /> : <UploadIcon />}
            </button>
            {uploadOpen && <div className="dsh-knowledge-upload-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { fileInput.current?.click(); setUploadOpen(false) }}><FileMenuIcon />{productText('本地文件')}</button>
              <button type="button" role="menuitem" onClick={() => { folderInput.current?.click(); setUploadOpen(false) }}><FolderIcon />{productText('本地文件夹')}</button>
              <button type="button" role="menuitem" onClick={() => { setUploadOpen(false); setError(productText('暂不支持该来源')) }}><BookIcon />{productText('个人知识库')}</button>
              <button type="button" role="menuitem" onClick={() => { setUploadOpen(false); setError(productText('暂不支持该来源')) }}><LinkIcon />{productText('网页链接')}</button>
              <button type="button" role="menuitem" className="submenu" onClick={() => { setUploadOpen(false); setError(productText('暂不支持该来源')) }}><span><NoteIcon />{productText('笔记')}</span><ChevronIcon /></button>
              <button type="button" role="menuitem" onClick={() => { setUploadOpen(false); setError(productText('暂不支持该来源')) }}><DocIcon />{productText('腾讯文档')}</button>
              <button type="button" role="menuitem" onClick={() => { setUploadOpen(false); setError(productText('暂不支持该来源')) }}><MicIcon />{productText('录音纪要')}</button>
              <hr />
              <button type="button" role="menuitem" onClick={() => { setUploadOpen(false); setError(productText('暂不支持该来源')) }}><FolderPlusIcon />{productText('新建文件夹')}</button>
            </div>}
          </div>
        </div>
      </div>
      <input ref={fileInput} type="file" hidden multiple onChange={event => takeFiles(event.currentTarget)} />
      <input ref={folderInput} type="file" hidden multiple onChange={event => takeFiles(event.currentTarget)} />
      <div className="dsh-knowledge-list-pane">
        {searchOpen && <input className="dsh-knowledge-filter" value={query} onChange={event => setQuery(event.target.value)} placeholder={productText('搜索内容')} />}
        {loading ? <p role="status">{productText('正在加载…')}</p> : shownDocuments.length === 0
          ? <p className="dsh-knowledge-empty">{productText('暂无内容')}</p>
          : <div className="dsh-knowledge-documents">{renderContentTree(contentTree, {
            depth: 0,
            expandedFolders,
            searching,
            selectedDocumentIds,
            onToggleFolder: toggleFolder,
            onToggleDocumentSelection: toggleDocumentSelection,
            onOpenDocument: openDocument,
            onOpenMenu: openDocumentMenu,
          })}</div>}
      </div>
    </main>
    <div className="dsh-knowledge-split" role="separator" aria-orientation="vertical" tabIndex={0}
      aria-label={productText('调整内容宽度')} aria-valuemin={CONTENT_MIN} aria-valuemax={contentLimit} aria-valuenow={contentWidth}
      onPointerDown={resizeContent} onKeyDown={nudgeContent} />
    <section className="dsh-knowledge-chat" aria-label={productText('基于知识库问答')}>
      <div className="dsh-knowledge-messages" ref={messagesPane}>
        {messages.length === 0 && <div className="dsh-knowledge-chat-empty"><p><span><ChatIcon /></span>{productText('基于知识库问答')}</p></div>}
        {messages.map((message, index) => {
          const waiting = message.role === 'assistant' && message.content === ''
            && answering && index === messages.length - 1
          const citations = message.citations ?? []
          return <article className={message.role} key={`${message.role}-${index}`}>
            {message.role === 'assistant' && <header className="dsh-knowledge-assistant-brand">
              <img src="/brand-mark.svg" width={18} height={16} alt="" />
              <strong>{productText('万维')}</strong>
            </header>}
            {waiting
              ? <p className="dsh-knowledge-typing" role="status" aria-label={productText('正在回答…')}>
                <span /><span /><span />
              </p>
              : message.content !== '' && <p>{renderAnswerBody(message.content, citations, openCitation)}</p>}
            {message.recommendations && message.recommendations.length > 0 &&
              <div className="dsh-knowledge-related"><small>{productText('相关问题')}</small>
                {message.recommendations.map(value =>
                  <button type="button" key={value} onClick={() => setQuestion(value)}>{value}</button>)}</div>}
          </article>
        })}
      </div>
      <form className="dsh-knowledge-composer" onSubmit={ask}>
        <textarea value={question} disabled={selectedId === undefined || answering} rows={2}
          onChange={event => setQuestion(event.target.value)} placeholder={productText('基于知识库提问')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              if (!answering) event.currentTarget.form?.requestSubmit()
            }
          }} />
        <div className="dsh-knowledge-composer-bar">
          <div className="dsh-knowledge-composer-actions">
            {answering
              ? <button type="button" className="dsh-knowledge-send stop" aria-label={productText('停止')} onClick={stopAnswer}>
                <StopIcon />
              </button>
              : <button type="submit" className={question.trim() === '' ? 'dsh-knowledge-send idle' : 'dsh-knowledge-send ready'}
                aria-label={productText('发送')}
                disabled={question.trim() === '' || selectedId === undefined}>
                <SendIcon />
              </button>}
          </div>
        </div>
      </form>
    </section>
    {error !== '' && <div role="alert" className="dsh-knowledge-error">{error}<button type="button" aria-label={productText('关闭')} onClick={() => setError('')}>×</button></div>}
    {documentMenu !== undefined && <div className="dsh-knowledge-context-menu" role="menu"
      style={{ left: documentMenu.x, top: documentMenu.y }}
      onPointerDown={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}>
      <button type="button" role="menuitem" onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        startTransfer('move')
      }}><MoveIcon />{productText('移动到')}</button>
      <button type="button" role="menuitem" onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        startTransfer('copy')
      }}><CopyIcon />{productText('复制到')}</button>
      <button type="button" role="menuitem" className="danger" onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const ids = selectedDocumentIds.length > 0 ? selectedDocumentIds : [documentMenu.documentId]
        setDocumentMenu(undefined)
        setDeleteIds(ids)
      }}><TrashIcon />{productText('删除')}</button>
    </div>}
    {transfer !== undefined && <div className="dsh-knowledge-modal-backdrop"
      onPointerDown={event => event.stopPropagation()}>
      <section className="dsh-knowledge-transfer" role="dialog"
        aria-modal="true" aria-labelledby="dsh-knowledge-transfer-title">
        <header>
          <h2 id="dsh-knowledge-transfer-title">
            {transfer.mode === 'copy' ? productText('复制') : productText('移动')}
            {transfer.documentIds.length === 1
              ? `: ${documents.find(item => item.id === transfer.documentIds[0])?.name ?? ''}`
              : ` (${transfer.documentIds.length})`}
          </h2>
          <button type="button" aria-label={productText('关闭')} disabled={transfer.busy}
            onClick={() => setTransfer(undefined)}>×</button>
        </header>
        {transfer.busy
          ? <div className="dsh-knowledge-transfer-progress" role="status">
            <span className="dsh-knowledge-upload-busy" aria-hidden="true" />
            <p>{productText('剩余 {count} 个内容').replace('{count}', String(transfer.remaining))}</p>
          </div>
          : <div className="dsh-knowledge-transfer-body">
            <aside>
              {([
                { kind: 'personal' as const, label: productText('个人知识库') },
                { kind: 'shared' as const, label: productText('共享知识库') },
              ]).map((group) => {
                const rows = transferTargets.filter(item => item.kind === group.kind)
                if (rows.length === 0) return null
                return <div key={group.kind}>
                  <strong>{group.label}</strong>
                  {rows.map(item =>
                    <button type="button" key={item.id} className={item.id === transfer.targetId ? 'active' : ''}
                      onClick={() => setTransfer(current => current === undefined ? current : { ...current, targetId: item.id })}>
                      <BookIcon />{item.name}
                    </button>)}
                </div>
              })}
              {transferTargets.length === 0 && <p className="dsh-knowledge-empty">{productText('暂无可用知识库')}</p>}
            </aside>
            <div className="dsh-knowledge-transfer-preview">
              {transfer.documentIds.map((id) => {
                const document = documents.find(item => item.id === id)
                if (document === undefined) return null
                const kind = fileKind(document.name)
                return <div key={id}>
                  <span className={`dsh-knowledge-file-icon ${kind}`} aria-hidden="true"><TypeIcon kind={kind} /></span>
                  <strong>{document.name}</strong>
                </div>
              })}
            </div>
          </div>}
        <footer>
          <button type="button" disabled={transfer.busy} onClick={() => setTransfer(undefined)}>{productText('取消')}</button>
          <button type="button" disabled={transfer.busy || transfer.targetId === undefined}
            onClick={() => void runTransfer()}>
            {transfer.mode === 'copy' ? productText('复制至此') : productText('移动至此')}
          </button>
        </footer>
      </section></div>}
    {conflict !== undefined && <div className="dsh-knowledge-modal-backdrop"
      onPointerDown={event => event.stopPropagation()}>
      <section className="dsh-knowledge-modal" role="dialog"
        aria-modal="true" aria-labelledby="dsh-knowledge-conflict-title">
        <header><h2 id="dsh-knowledge-conflict-title">{productText('同名项目')}</h2>
          <button type="button" aria-label={productText('关闭')} onClick={() => closeConflict('cancel')}>×</button></header>
        <p>{productText('此处存在以下同名项目，请选择操作')}</p>
        <ul className="dsh-knowledge-conflict-list">{conflict.names.map(name => <li key={name}>{name}</li>)}</ul>
        <footer>
          <button type="button" onClick={() => closeConflict('keep')}>{productText('保留全部')}</button>
          <button type="button" onClick={() => closeConflict('replace')}>{productText('替换')}</button>
          <button type="button" onClick={() => closeConflict('cancel')}>{productText('取消')}</button>
        </footer>
      </section></div>}
    {deleteIds !== undefined && <div className="dsh-knowledge-modal-backdrop"
      onPointerDown={event => event.stopPropagation()}>
      <section className="dsh-knowledge-modal" role="dialog"
        aria-modal="true" aria-labelledby="dsh-knowledge-delete-title">
        <header><h2 id="dsh-knowledge-delete-title">{productText('确认删除')}</h2>
          <button type="button" aria-label={productText('关闭')} disabled={mutating} onClick={() => setDeleteIds(undefined)}>×</button></header>
        <p>{productText('确认删除所选内容？删除后将从知识库同步移除。')}</p>
        <ul className="dsh-knowledge-conflict-list">
          {deleteIds.map((id) => {
            const document = documents.find(item => item.id === id)
            return <li key={id}>{document?.name ?? id}</li>
          })}
        </ul>
        <footer>
          <button type="button" disabled={mutating} onClick={() => setDeleteIds(undefined)}>{productText('取消')}</button>
          <button type="button" className="danger" disabled={mutating} onClick={() => void confirmDelete()}>{productText('确认删除')}</button>
        </footer>
      </section></div>}
    {createKind !== undefined && <div className="dsh-knowledge-modal-backdrop"><form className="dsh-knowledge-modal" role="dialog" aria-modal="true"
      aria-labelledby="dsh-knowledge-create-title" onSubmit={submitCreate}>
      <header><h2 id="dsh-knowledge-create-title">{productText('新建个人知识库')}</h2>
        <button type="button" aria-label={productText('关闭')} onClick={() => setCreateKind(undefined)}>×</button></header>
      <label>{productText('名称')}<input autoFocus maxLength={128} value={name} onChange={event => setName(event.target.value)}
        placeholder={productText('请输入知识库名称')} /></label>
      <label>{productText('描述')}<textarea maxLength={500} value={description} onChange={event => setDescription(event.target.value)}
        placeholder={productText('请填写知识库描述')} /></label>
      <footer><button type="button" onClick={() => setCreateKind(undefined)}>{productText('取消')}</button>
        <button type="submit" disabled={name.trim() === '' || saving}>{productText('确定')}</button></footer>
    </form></div>}
    {viewer !== undefined && createPortal(<div className="dsh-knowledge-viewer-shell"
      onPointerDown={(event) => { event.stopPropagation() }}>
      <section className={previewAskOpen ? 'dsh-knowledge-viewer asking' : 'dsh-knowledge-viewer'} role="dialog" aria-modal="true" aria-labelledby="dsh-knowledge-viewer-title">
        <header>
          <div className="dsh-knowledge-viewer-title">
            <h2 id="dsh-knowledge-viewer-title">{documentDisplayName(viewer.document)}</h2>
            <button type="button" className="icon-only" aria-label={productText('下载')} disabled={downloading || viewer.loading}
              onClick={() => void downloadDocument()}>
              {downloading ? <span className="dsh-knowledge-viewer-busy" aria-hidden="true" /> : <DownloadTrayIcon />}
            </button>
          </div>
          <div className="dsh-knowledge-viewer-actions">
            {!previewAskOpen && <button type="button" className="dsh-knowledge-ask-launch" onClick={() => setPreviewAskOpen(true)}>
              <AskWanweiIcon />{productText('问问万维')}
            </button>}
            {!previewAskOpen && <button type="button" className="icon-only close" aria-label={productText('关闭')}
              onClick={(event) => { event.stopPropagation(); closeViewer() }}>
              <CloseIcon />
            </button>}
          </div>
        </header>
        <div className={`dsh-knowledge-viewer-body ${viewer.mode}`} ref={previewBodyRef}>
          {viewer.loading ? <ViewerLoading label={productText('正在加载…')} />
            : viewer.mode === 'image' && viewer.objectUrl !== undefined
              ? <img src={viewer.objectUrl} alt={documentDisplayName(viewer.document)} />
              : viewer.mode === 'pdf' && viewer.pdfBytes !== undefined
                ? <PdfLocateViewer bytes={viewer.pdfBytes} locate={viewer.locate} />
                : (viewer.content ?? '') === ''
                  ? <p className="dsh-knowledge-empty">{productText('暂无解析内容')}</p>
                  : viewer.markdown === true
                    ? <MarkdownView source={viewer.content ?? ''} />
                    : <article><pre>{viewer.content}</pre></article>}
        </div>
        {previewAskOpen && <PreviewAskPane
          fileName={documentDisplayName(viewer.document)}
          mode={viewer.mode}
          hints={previewHints}
          messages={previewMessages}
          question={previewQuestion}
          answering={answering}
          disabled={selectedId === undefined}
          paneRef={previewMessagesPane}
          onClose={() => setPreviewAskOpen(false)}
          onDismissHints={() => setPreviewHints(false)}
          onQuestion={setPreviewQuestion}
          onSubmit={askPreview}
          onPrompt={askPreviewPrompt}
          onStop={stopAnswer}
          onOpenCitation={locateInPreview}
        />}
      </section>
    </div>, document.body)}
  </section>
}

function PreviewAskPane({
  fileName, mode, hints, messages, question, answering, disabled, paneRef,
  onClose, onDismissHints, onQuestion, onSubmit, onPrompt, onStop, onOpenCitation,
}: {
  fileName: string
  mode: DocumentViewer['mode']
  hints: boolean
  messages: Message[]
  question: string
  answering: boolean
  disabled: boolean
  paneRef: { current: HTMLDivElement | null }
  onClose: () => void
  onDismissHints: () => void
  onQuestion: (value: string) => void
  onSubmit: (event: FormEvent) => void
  onPrompt: (prompt: string) => void
  onStop: () => void
  onOpenCitation: (citation: KnowledgeCitation, answerHint?: string) => void
}) {
  const prompts = previewQuickPrompts(fileName, mode)
  const showHints = hints && messages.length === 0
  return <aside className="dsh-knowledge-preview-ask" role="complementary" aria-label={productText('问问万维')}>
    <header>
      <strong><AskWanweiIcon />{productText('问问万维')}</strong>
      <button type="button" aria-label={productText('关闭问问万维')} onClick={onClose}><CloseIcon /></button>
    </header>
    <div className="dsh-knowledge-preview-ask-log" ref={paneRef}>
      <p className="dsh-knowledge-preview-ask-hello">{productText('你好，我是你的智能助手万维，能帮你速读文章、答疑解惑，快向我提问吧！')}</p>
      {showHints && mode === 'image' && prompts[0] !== undefined &&
        <button type="button" className="dsh-knowledge-preview-ask-image" disabled={answering || disabled}
          onClick={() => onPrompt(prompts[0]!.prompt)}>{productText(prompts[0].label)}</button>}
      {messages.map((message, index) => {
        const waiting = message.role === 'assistant' && message.content === '' && answering && index === messages.length - 1
        const citations = message.citations ?? []
        return <article className={message.role} key={`${message.role}-${index}`}>
          {message.role === 'assistant' && <header className="dsh-knowledge-assistant-brand">
            <img src="/brand-mark.svg" width={18} height={16} alt="" />
            <strong>{productText('万维')}</strong>
          </header>}
          {waiting
            ? <p className="dsh-knowledge-typing" role="status" aria-label={productText('正在回答…')}><span /><span /><span /></p>
            : message.content !== '' && <p>{message.role === 'assistant'
              ? renderAnswerBody(message.content, citations, onOpenCitation)
              : message.content}</p>}
        </article>
      })}
    </div>
    {showHints && mode !== 'image' && <div className="dsh-knowledge-preview-ask-file">
      <div>
        <span className={`dsh-knowledge-file-icon ${mode === 'pdf' ? 'pdf' : 'file'}`} aria-hidden="true">
          <TypeIcon kind={mode === 'pdf' ? 'pdf' : 'file'} />
        </span>
        <strong>{fileName}</strong>
        <button type="button" aria-label={productText('移除当前文件')} onClick={onDismissHints}>×</button>
      </div>
      <div className="dsh-knowledge-preview-ask-chips">
        {prompts.map(item =>
          <button type="button" key={item.label} disabled={answering || disabled} onClick={() => onPrompt(item.prompt)}>
            {productText(item.label)}
          </button>)}
      </div>
    </div>}
    <form className="dsh-knowledge-preview-ask-composer" onSubmit={onSubmit}>
      <textarea value={question} disabled={disabled || answering} rows={2}
        placeholder={productText('有问题尽管问万维')}
        onChange={event => onQuestion(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            if (!answering) event.currentTarget.form?.requestSubmit()
          }
        }} />
      {answering
        ? <button type="button" className="dsh-knowledge-send stop" aria-label={productText('停止')} onClick={onStop}><StopIcon /></button>
        : <button type="submit" className={question.trim() === '' ? 'dsh-knowledge-send idle' : 'dsh-knowledge-send ready'}
          aria-label={productText('发送')} disabled={question.trim() === '' || disabled}><SendIcon /></button>}
    </form>
  </aside>
}

function previewQuickPrompts(fileName: string, mode: DocumentViewer['mode']): { label: '解读图片' | '总结' | '生成脑图' | '生成测验' | '生成播客'; prompt: string }[] {
  if (mode === 'image') {
    return [{ label: '解读图片', prompt: `请解读图片「${fileName}」的内容。` }]
  }
  return [
    { label: '总结', prompt: `请总结文件「${fileName}」的主要内容。` },
    { label: '生成脑图', prompt: `请根据文件「${fileName}」整理一份脑图大纲，用纯文本层级列出要点。` },
    { label: '生成测验', prompt: `请根据文件「${fileName}」出几道测验题，并在每题后给出答案。` },
    { label: '生成播客', prompt: `请把文件「${fileName}」整理成一段口语化的讲解稿。` },
  ]
}

function AskWanweiIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 16.5 4 20l4.2-1.4A8 8 0 1 0 6 16.5Z" />
  </svg>
}

function renderAnswerBody(
  content: string,
  citations: KnowledgeCitation[],
  onOpen: (citation: KnowledgeCitation, answerHint?: string) => void,
): ReactNode {
  const parts = splitAnswerCitations(content, citations)
  let preceding = ''
  return parts.map((part, index) => {
    if (part.type === 'text') {
      preceding += part.text
      return <span key={`t-${index}`}>{part.text}</span>
    }
    const marker = `【${part.citation.index}】`
    const hint = citationLocateHint(preceding)
    return <button type="button" key={`c-${part.citation.chunk_index}-${index}`}
      className="dsh-knowledge-cite"
      aria-label={`${productText('引用定位')} ${marker}`}
      onClick={() => onOpen(part.citation, hint)}>
      {marker}
    </button>
  })
}

function PlusIcon() {
  return <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M7 1.5v11M1.5 7h11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
}

function CheckIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12 5 5L19 7" />
  </svg>
}

function MoveIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12M8.5 11.5 12 15l3.5-3.5" />
    <path d="M5 18.5h14" />
  </svg>
}

function CopyIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
}

function TrashIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12" />
  </svg>
}

function DownloadTrayIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4v10M8.5 10.5 12 14l3.5-3.5" />
    <path d="M5 18h14" />
  </svg>
}

function CloseIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
}

function BackIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M15 6 9 12l6 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function BookIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5A2.5 2.5 0 0 0 5 21.5v-17Z" />
    <path d="M5 19a2 2 0 0 1 2-2h12" />
  </svg>
}

/** Title mark beside the plaza heading. */
function PlazaMarkIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3.2 14.7 9h6.1l-4.9 3.7 1.9 6.1L12 15.4 6.2 18.8l1.9-6.1L3.2 9h6.1L12 3.2Z"
      fill="#2f6fe0" opacity=".9" />
  </svg>
}

/**
 * Theme-blue filled folder for sidebar rows and the content header — matches the
 * product folder mark (tab + horizontal slot).
 */
function LibraryFolderIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor"
      d="M4 7.2C4 6 5 5 6.2 5h3.2l1.4 1.4H17.8C19 6.4 20 7.4 20 8.6v9.2c0 1.2-1 2.2-2.2 2.2H6.2C5 20 4 19 4 17.8V7.2Z" />
    <rect x="7.2" y="9.6" width="9.6" height="1.8" rx="0.9" fill="#fff" />
  </svg>
}

/** Product-staged natural-resources cover for plaza cards and detail. */
const PLAZA_NATURAL_RESOURCES_COVER = '/knowledge-covers/plaza-natural-resources.jpg'

/**
 * Full photo cover for plaza cards — natural-resources landscape.
 * @param props.seed - Stable library id (kept for call-site compatibility).
 */
function PlazaCoverIcon({ seed: _seed }: { seed: number }) {
  return <img src={PLAZA_NATURAL_RESOURCES_COVER} alt="" draggable={false} />
}

interface PlazaTreeHandlers {
  depth: number
  expandedFolders: Set<string>
  onToggleFolder: (path: string) => void
}

/** Render plaza catalog rows as a name / type / updated table.
 * @param nodes - Tree nodes at the current depth.
 * @param handlers - Folder expansion handlers.
 * @returns Flattened row elements.
 */
function renderPlazaContentTree(nodes: ContentNode[], handlers: PlazaTreeHandlers): ReactNode[] {
  const rows: ReactNode[] = []
  for (const node of nodes) {
    if (node.type === 'folder') {
      const expanded = handlers.expandedFolders.has(node.path)
      rows.push(
        <button type="button" key={`plaza-folder:${node.path}`} className="dsh-knowledge-plaza-file"
          role="listitem" style={{ paddingLeft: `${14 + handlers.depth * 16}px` }}
          aria-expanded={expanded}
          onClick={() => handlers.onToggleFolder(node.path)}>
          <span className="dsh-knowledge-plaza-file-icon folder" aria-hidden="true"><FolderIcon /></span>
          <strong>{node.name}</strong>
          <span className="dsh-knowledge-plaza-file-type">{productText('文件夹')}</span>
          <span className="dsh-knowledge-plaza-file-date">-</span>
        </button>,
      )
      if (expanded) {
        rows.push(...renderPlazaContentTree(node.children, { ...handlers, depth: handlers.depth + 1 }))
      }
      continue
    }
    const document = node.document
    const stamp = documentTime(document)
    rows.push(
      <div key={`plaza-file:${document.id}`} className="dsh-knowledge-plaza-file" role="listitem"
        style={{ paddingLeft: `${14 + handlers.depth * 16}px` }}>
        <span className={`dsh-knowledge-plaza-file-icon ${fileKind(documentDisplayName(document))}`} aria-hidden="true">
          <TypeIcon kind={fileKind(documentDisplayName(document))} />
        </span>
        <strong>{documentDisplayName(document)}</strong>
        <span className="dsh-knowledge-plaza-file-type">{productText(kindLabel(fileKind(documentDisplayName(document))))}</span>
        <span className="dsh-knowledge-plaza-file-date">
          {stamp > 0 ? productText('{date}更新').replace('{date}', formatPlazaDate(stamp)) : '-'}
        </span>
      </div>,
    )
  }
  return rows
}

/** Compact month/day label for plaza catalog rows.
 * @param stamp - Unix seconds or milliseconds.
 * @returns Local `M/D` text.
 */
function formatPlazaDate(stamp: number): string {
  const ms = stamp > 1e12 ? stamp : stamp * 1000
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function FileIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z" />
    <path d="M14 3.5V9h5.5" />
  </svg>
}

function ChatIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 16.5 4 20l4.2-1.4A8 8 0 1 0 6 16.5Z" />
  </svg>
}

function SendIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M4.2 11.1 18.6 4.4c.7-.3 1.4.4 1.1 1.1L13 20.8c-.3.7-1.3.6-1.5-.1l-1.7-5.4a1 1 0 0 1 .5-1.2l5-2.4-6.7-.4a1 1 0 0 1-.8-.6L4.2 11.1Z" />
  </svg>
}

function StopIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <rect x="2" y="2" width="8" height="8" rx="1.2" fill="currentColor" />
  </svg>
}

/** Prefer the stored relative path, then the document name.
 * @param document - Listed knowledge document.
 * @returns Slash-normalized relative path used for folder grouping.
 */
function documentStoragePath(document: KnowledgeDocument): string {
  const raw = document.location !== undefined && document.location !== '' ? document.location : document.name
  return raw.replace(/\\/g, '/').replace(/^\/+/u, '')
}

/** Visible file name without parent folders.
 * @param document - Listed knowledge document.
 * @returns Base file name.
 */
function documentDisplayName(document: KnowledgeDocument): string {
  const path = documentStoragePath(document)
  const index = path.lastIndexOf('/')
  return index >= 0 ? path.slice(index + 1) : path
}

/** Top-level folder paths present in the document list.
 * @param documents - Listed knowledge documents.
 * @returns Folder paths to expand by default.
 */
function topLevelFolderPaths(documents: KnowledgeDocument[]): Set<string> {
  const paths = new Set<string>()
  for (const document of documents) {
    const storage = documentStoragePath(document)
    const slash = storage.indexOf('/')
    if (slash > 0) paths.add(storage.slice(0, slash))
  }
  return paths
}

/** Group documents into nested folders from relative storage paths.
 * @param documents - Filtered documents to show.
 * @param newestFirst - Sort files by upload time when true.
 * @returns Root-level tree nodes.
 */
function buildContentTree(documents: KnowledgeDocument[], newestFirst: boolean): ContentNode[] {
  type FolderAcc = {
    path: string
    name: string
    folders: Map<string, FolderAcc>
    files: KnowledgeDocument[]
  }
  const root: FolderAcc = { path: '', name: '', folders: new Map(), files: [] }
  for (const document of documents) {
    const parts = documentStoragePath(document).split('/').filter(part => part !== '')
    if (parts.length <= 1) {
      root.files.push(document)
      continue
    }
    let cursor = root
    for (let index = 0; index < parts.length - 1; index += 1) {
      const name = parts[index]
      if (name === undefined) continue
      const path = parts.slice(0, index + 1).join('/')
      let next = cursor.folders.get(name)
      if (next === undefined) {
        next = { path, name, folders: new Map(), files: [] }
        cursor.folders.set(name, next)
      }
      cursor = next
    }
    cursor.files.push(document)
  }
  const sortFiles = (files: KnowledgeDocument[]) => [...files].sort((left, right) => {
    const delta = documentTime(left) - documentTime(right)
    if (delta !== 0) return newestFirst ? -delta : delta
    return documentDisplayName(left).localeCompare(documentDisplayName(right))
  })
  const finalize = (folder: FolderAcc): ContentNode[] => {
    const folders = [...folder.folders.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(entry => ({
        type: 'folder' as const,
        path: entry.path,
        name: entry.name,
        children: finalize(entry),
      }))
    const files = sortFiles(folder.files).map(document => ({ type: 'file' as const, document }))
    return [...folders, ...files]
  }
  return finalize(root)
}

type ContentTreeHandlers = {
  depth: number
  expandedFolders: Set<string>
  searching: boolean
  selectedDocumentIds: string[]
  onToggleFolder: (path: string) => void
  onToggleDocumentSelection: (documentId: string) => void
  onOpenDocument: (document: KnowledgeDocument) => void
  onOpenMenu: (documentId: string, x: number, y: number) => void
}

/** Render nested folder and file rows for the content pane.
 * @param nodes - Tree nodes at the current depth.
 * @param handlers - Expansion and document interaction handlers.
 * @returns Flattened row elements.
 */
function renderContentTree(nodes: ContentNode[], handlers: ContentTreeHandlers): ReactNode[] {
  const rows: ReactNode[] = []
  for (const node of nodes) {
    if (node.type === 'folder') {
      const expanded = handlers.searching || handlers.expandedFolders.has(node.path)
      rows.push(
        <button type="button" key={`folder:${node.path}`} className="folder"
          style={{ paddingLeft: `${4 + handlers.depth * 14}px` }}
          aria-expanded={expanded}
          onClick={() => handlers.onToggleFolder(node.path)}>
          <span className="dsh-knowledge-file-icon folder" aria-hidden="true"><FolderIcon /></span>
          <div>
            <strong>{node.name}</strong>
            <small>{productText('文件夹')}</small>
          </div>
          <span className={expanded ? 'dsh-knowledge-folder-chevron open' : 'dsh-knowledge-folder-chevron'} aria-hidden="true">
            <ChevronIcon />
          </span>
        </button>,
      )
      if (expanded) {
        rows.push(...renderContentTree(node.children, { ...handlers, depth: handlers.depth + 1 }))
      }
      continue
    }
    const document = node.document
    const kind = fileKind(documentDisplayName(document))
    const clock = formatClock(documentTime(document))
    const selectedDoc = handlers.selectedDocumentIds.includes(document.id)
    rows.push(
      <button type="button" key={document.id}
        className={selectedDoc ? 'selected' : ''}
        style={{ paddingLeft: `${4 + handlers.depth * 14}px` }}
        aria-pressed={selectedDoc}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey) {
            handlers.onToggleDocumentSelection(document.id)
            return
          }
          handlers.onOpenDocument(document)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          handlers.onOpenMenu(document.id, event.clientX, event.clientY)
        }}>
        <span className={`dsh-knowledge-file-icon ${kind}`} aria-hidden="true"><TypeIcon kind={kind} /></span>
        <div>
          <strong>{documentDisplayName(document)}</strong>
          <small>{clock === '' ? productText(kindLabel(kind)) : `${productText(kindLabel(kind))} | ${clock}`}</small>
        </div>
        {selectedDoc && <span className="dsh-knowledge-check" aria-hidden="true"><CheckIcon /></span>}
      </button>,
    )
  }
  return rows
}

/** Skip OS junk that directory picks often include.
 * @param name - File base name from the picker.
 * @returns True when the file should not be uploaded.
 */
function isSkippedUploadName(name: string): boolean {
  const base = name.split(/[/\\]/).pop() ?? name
  if (base === '' || base === '.' || base === '..') return true
  const lower = base.toLowerCase()
  return lower === '.ds_store' || lower === 'thumbs.db' || lower === 'desktop.ini' || lower.startsWith('._')
}

type FileKind = 'image' | 'pdf' | 'word' | 'sheet' | 'database' | 'file'

function fileExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function fileKind(name: string): FileKind {
  const extension = fileExtension(name)
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(extension)) return 'image'
  if (extension === 'pdf') return 'pdf'
  if (['doc', 'docx'].includes(extension)) return 'word'
  if (['xls', 'xlsx', 'csv'].includes(extension)) return 'sheet'
  if (['mdb', 'accdb'].includes(extension)) return 'database'
  return 'file'
}

function isPlainTextName(name: string): boolean {
  return ['md', 'txt', 'json', 'csv', 'log', 'xml', 'html', 'htm', 'css', 'js', 'ts', 'tsx', 'jsx', 'yaml', 'yml'].includes(fileExtension(name))
}

function isMarkdownName(name: string): boolean {
  return fileExtension(name) === 'md' || fileExtension(name) === 'markdown'
}

function mimeFor(name: string, contentType: string): string {
  if (contentType !== '' && !contentType.includes('octet-stream')) return contentType
  const extension = fileExtension(name)
  if (extension === 'pdf') return 'application/pdf'
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'bmp') return 'image/bmp'
  if (extension === 'md' || extension === 'txt' || extension === 'log') return 'text/plain; charset=utf-8'
  if (extension === 'json') return 'application/json'
  if (extension === 'html' || extension === 'htm') return 'text/html; charset=utf-8'
  return contentType || 'application/octet-stream'
}

function kindLabel(kind: FileKind): '图片' | 'PDF' | 'Word' | '表格' | '数据库' | '文件' {
  if (kind === 'image') return '图片'
  if (kind === 'pdf') return 'PDF'
  if (kind === 'word') return 'Word'
  if (kind === 'sheet') return '表格'
  if (kind === 'database') return '数据库'
  return '文件'
}

function documentTime(document: KnowledgeDocument): number {
  const value = document.create_time || document.update_time || 0
  return value > 1e12 ? value : value * 1000
}

function formatClock(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function TypeIcon({ kind }: { kind: FileKind }) {
  if (kind === 'image') return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.4" fill="currentColor" /><path d="m7 16 3.2-3.2a1 1 0 0 1 1.4 0L16 17" /></svg>
  if (kind === 'pdf') return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z" /><path fill="#fff" d="M8 14.2h1.2c.8 0 1.3-.4 1.3-1.1S10 12 9.2 12H8v2.2Zm.7-1.7h.4c.3 0 .5.1.5.4s-.2.4-.5.4H8.7v-.8Zm2.2 1.7h1.2c1 0 1.6-.5 1.6-1.3s-.6-1.3-1.6-1.3h-1.2v2.6Zm.7-.5v-1.6h.4c.5 0 .8.2.8.8s-.3.8-.8.8h-.4Zm2.5.5h.7V12h-.7v2.2Z" /></svg>
  return <FileIcon />
}

function SearchIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" strokeLinecap="round" /></svg>
}

function SortIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M8 6v12M8 6 5 9M8 6l3 3M16 18V6M16 18l-3-3M16 18l3-3" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function UploadIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 16V6M12 6l-3.5 3.5M12 6l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 18.5h14" strokeLinecap="round" /></svg>
}

function FileMenuIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M7 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z" /><path d="M14 3.5V9h5.5" /></svg>
}

function FolderIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3.5 8.5V18a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-7l-2-2h-4a2 2 0 0 0-2 2.5Z" /></svg>
}

function LinkIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" strokeLinecap="round" /><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1" strokeLinecap="round" /></svg>
}

function NoteIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M7 4.5h8l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 5.5 19V6A1.5 1.5 0 0 1 7 4.5Z" /><path d="M15 4.5V9h4.5M8.5 13h7M8.5 16.5h5" /></svg>
}

function DocIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M8.5 8h7M8.5 12h7M8.5 16h4" /></svg>
}

function MicIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V20" strokeLinecap="round" /></svg>
}

function FolderPlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3.5 8.5V18a2 2 0 0 0 2 2h8" /><path d="M3.5 8.5A2 2 0 0 1 5.5 6.5h4l2 2h8a2 2 0 0 1 2 2V12" /><path d="M18 15v6M15 18h6" strokeLinecap="round" /></svg>
}

function ChevronIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
