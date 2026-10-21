import { productText } from './locales/product.ts'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChangeEvent } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ClientPlatformActions } from '@deepseek-ai/dsh-client-platform-actions/client'
import type { DeliverableExtensions } from '@deepseek-ai/dsh-client-ui-deliverables/client'
import { AnalysisResultCard } from './AnalysisResultCard.tsx'
import { importedFileReference } from './imported-file-reference.ts'
import { wanweiDeliverablePaths } from './deliverable-paths.ts'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputActions, IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import './theme.css'

type BrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps
type FileImportProps = Pick<PropsRuntime<'conversation.composer.tools'>, 'sessionId' | 'useWorkspaces'> & {
  inputActions: Pick<InputActions, 'appendReferences'>
}
type NativeInvoke = (command: string, argumentsValue?: unknown) => Promise<unknown>

function invokeDesktop(command: string, argumentsValue?: unknown): Promise<unknown> {
  const invoke = (window as Window & { __ZJUGIS_NATIVE_INVOKE__?: NativeInvoke }).__ZJUGIS_NATIVE_INVOKE__
  if (invoke === undefined) throw new Error('Desktop native capabilities are unavailable')
  return invoke(command, argumentsValue)
}

function useActiveWorkspacePath(props: FileImportProps): string | undefined {
  const workspaces = props.useWorkspaces(value => value.items)
  const id = props.sessionId
  return id === undefined ? undefined
    : workspaces.find(workspace => workspace.sessionIds.includes(id))?.path
}

async function nativeImport(
  command: 'import_workspace_files' | 'import_dropped_workspace_files' | 'import_clipboard_workspace_files',
  workspacePath: string | undefined,
  files?: readonly File[],
): Promise<readonly string[]> {
  const payload = files === undefined ? undefined : await Promise.all(files.map(async file => ({
    name: file.name,
    bytes: [...new Uint8Array(await file.arrayBuffer())],
  })))
  const result = await invokeDesktop(command, {
    workspacePath,
    ...(payload === undefined ? {} : { files: payload }),
  })
  if (!Array.isArray(result) || !result.every(value => typeof value === 'string')) throw new Error('桌面端返回了无效的文件路径')
  return result
}

/** Imports desktop files into the session composer as structured references. */
export function FileImportAction(props: FileImportProps) {
  const workspacePath = useActiveWorkspacePath(props)
  const picker = useRef<HTMLInputElement>(null)
  const importing = useRef(false)
  const dropCard = picker.current?.closest<HTMLElement>('[data-composer-card]')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [dragActive, setDragActive] = useState(false)
  const [status, setStatus] = useState<{ text: string; error: boolean }>()
  useEffect(() => {
    if (status === undefined || busy) return
    const timer = window.setTimeout(() => { setStatus(undefined) }, status.error ? 6000 : 3000)
    return () => { window.clearTimeout(timer) }
  }, [status, busy])
  const append = (paths: readonly string[]) => {
    if (!props.inputActions.appendReferences(paths.map(importedFileReference))) {
      throw new Error(productText('文件已导入，但输入框正在发送，请稍后重新添加文件'))
    }
  }
  const importFiles = async (files: readonly File[], fromClipboard = false) => {
    if (files.length === 0 || importing.current) return
    importing.current = true
    setBusy(true)
    setError(undefined)
    setStatus({ text: productText('正在导入文件…'), error: false })
    try {
      // OS directories can appear as File objects whose arrayBuffer() rejects with NotFoundError.
      const clipboardPaths = fromClipboard
        ? await nativeImport('import_clipboard_workspace_files', workspacePath) : []
      const paths = clipboardPaths.length > 0 ? clipboardPaths
        : await nativeImport('import_workspace_files', workspacePath, files)
      append(paths)
      setStatus({ text: productText('已导入 {0} 个文件', [paths.length]), error: false })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      setStatus({ text: productText('文件导入失败：{0}', [message]), error: true })
    }
    finally { importing.current = false; setBusy(false) }
  }
  useEffect(() => {
    const relayedPastes = new WeakSet<Event>()
    let nativePasteTimer: number | undefined
    let pasteClaimed = false
    const composerTarget = (target: EventTarget | null): target is HTMLElement => {
      const card = picker.current?.closest('[data-composer-card]')
      return card != null && target instanceof HTMLElement && target.closest('[data-composer-card]') === card
        && target.closest('[contenteditable="true"]') !== null
    }
    const importNative = (command: 'import_dropped_workspace_files' | 'import_clipboard_workspace_files') => {
      if (importing.current) return
      importing.current = true
      setBusy(true)
      setError(undefined)
      setStatus({ text: productText('正在导入文件…'), error: false })
      void nativeImport(command, workspacePath)
        .then((paths) => {
          if (paths.length === 0) { setStatus(undefined); return }
          append(paths)
          setStatus({ text: productText('已导入 {0} 个文件', [paths.length]), error: false })
        })
        .catch((reason: unknown) => {
          const message = reason instanceof Error ? reason.message : String(reason)
          setError(message)
          setStatus({ text: productText('文件导入失败：{0}', [message]), error: true })
        })
        .finally(() => { importing.current = false; setBusy(false) })
    }
    const paste = (event: ClipboardEvent) => {
      if (relayedPastes.has(event) || !composerTarget(event.target)) return
      const clipboard = event.clipboardData
      if (clipboard === null) return
      const listed = Array.from(clipboard.files)
      const files = listed.length > 0 ? listed : Array.from(clipboard.items)
        .filter(item => item.kind === 'file').map(item => item.getAsFile())
        .filter((file): file is File => file !== null)
      const text = clipboard.getData('text/plain')
      pasteClaimed = files.length > 0 || text !== ''
      if (!pasteClaimed && (window as Window & { __ZJUGIS_NATIVE_INVOKE__?: NativeInvoke }).__ZJUGIS_NATIVE_INVOKE__) {
        pasteClaimed = true
        importNative('import_clipboard_workspace_files')
        return
      }
      const documents = files.filter(file => !file.type.startsWith('image/'))
      if (documents.length === 0) return
      event.preventDefault()
      event.stopImmediatePropagation()
      void importFiles(documents, true)
      // Relay only images/text to the existing editor so document bytes never enter image validation.
      const images = files.filter(file => file.type.startsWith('image/'))
      if (images.length === 0 && text === '') return
      const relay = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(relay, 'clipboardData', { value: {
        files: images,
        items: images.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
        getData: (format: string) => format === 'text/plain' ? text : '',
      } })
      relayedPastes.add(relay)
      event.target.dispatchEvent(relay)
    }
    const keydown = (event: KeyboardEvent) => {
      if (!composerTarget(event.target) || !(event.ctrlKey || event.metaKey) || event.altKey
        || event.shiftKey || event.repeat || event.isComposing || event.key.toLowerCase() !== 'v') return
      if ((window as Window & { __ZJUGIS_NATIVE_INVOKE__?: NativeInvoke }).__ZJUGIS_NATIVE_INVOKE__ === undefined) return
      pasteClaimed = false
      if (nativePasteTimer !== undefined) window.clearTimeout(nativePasteTimer)
      // OS file-list formats can produce no DOM paste payload; let ordinary paste run first.
      nativePasteTimer = window.setTimeout(() => {
        nativePasteTimer = undefined
        if (!pasteClaimed && composerTarget(document.activeElement)) importNative('import_clipboard_workspace_files')
      }, 0)
    }
    const browserDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
    const browserDrop = (event: DragEvent) => {
      const files = [...(event.dataTransfer?.files ?? [])]
      const documents = files.filter(file => !file.type.startsWith('image/'))
      if (documents.length === 0) return
      event.preventDefault()
      event.stopImmediatePropagation()
      setDragActive(false)
      void importFiles(documents)
    }
    const drop = () => {
      setDragActive(false)
      importNative('import_dropped_workspace_files')
    }
    const enter = () => { setDragActive(true) }
    const leave = () => { setDragActive(false) }
    document.addEventListener('drop', browserDrop, { capture: true })
    document.addEventListener('paste', paste, { capture: true })
    document.addEventListener('keydown', keydown, { capture: true })
    document.addEventListener('dragover', browserDragOver, { capture: true })
    window.addEventListener('dsh:native-file-drag-enter', enter)
    window.addEventListener('dsh:native-file-drag-leave', leave)
    window.addEventListener('dsh:native-file-drop', drop)
    return () => {
      document.removeEventListener('drop', browserDrop, { capture: true })
      document.removeEventListener('paste', paste, { capture: true })
      document.removeEventListener('keydown', keydown, { capture: true })
      if (nativePasteTimer !== undefined) window.clearTimeout(nativePasteTimer)
      document.removeEventListener('dragover', browserDragOver, { capture: true })
      window.removeEventListener('dsh:native-file-drag-enter', enter)
      window.removeEventListener('dsh:native-file-drag-leave', leave)
      window.removeEventListener('dsh:native-file-drop', drop)
    }
  }, [props.inputActions, workspacePath])
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.currentTarget.files ?? [])]
    event.currentTarget.value = ''
    void importFiles(files)
  }
  return (
    <>
      <input ref={picker} className="wanwei-product-file-input" type="file" multiple onChange={choose} />
      <button className="wanwei-product-file-button" type="button" disabled={busy} title={error ?? productText('导入文件')} aria-label={productText('导入文件')} data-error={error === undefined ? undefined : true} onClick={() => picker.current?.click()}>+</button>
      {dragActive && dropCard && createPortal(
        <div className="wanwei-product-drop-overlay" role="status">{productText('松开鼠标，将文件导入当前工作区')}</div>,
        dropCard,
      )}
      {status !== undefined && <div className="wanwei-product-import-status" role={status.error ? 'alert' : 'status'} data-error={status.error}>{status.text}</div>}
    </>
  )
}

function WanweiBrandMark({ size, className, wide }: BrandMarkProps) {
  // The production wordmark already contains the emblem. Keep the standalone
  // mark only for the collapsed rail so the expanded lockup is not duplicated.
  if (wide) return null
  return (
    <img
      src="/brand-mark.svg"
      width={size}
      height={size}
      className={className}
      style={{ display: 'block', width: `${size}px`, height: 'auto', margin: 0, objectFit: 'contain' }}
      alt=""
      aria-hidden="true"
    />
  )
}

function WanweiBrandName() {
  return (
    <span className="wanwei-product-wordmark" aria-hidden="true">
      <img src="/brand-wordmark.svg" height={36} alt="" />
    </span>
  )
}

function WanweiHeroBrand() {
  return (
    <span className="wanwei-product-hero-identity">
      <img className="wanwei-product-hero-brand" src="/brand-wordmark.svg" width={244} height={61} alt={productText('万维 Buddy')} />
      <span className="wanwei-product-hero-badge">{productText('专业智能助手')}</span>
    </span>
  )
}

export const inject = ['slots', 'platformActions', 'deliverableExtensions']

/** Installs only Wanwei-owned occupants; official DSH packages stay untouched. */
export function apply(ctx: Context): void {
  const platformActions = ctx.get('platformActions') as ClientPlatformActions
  const deliverableExtensions = ctx.get('deliverableExtensions') as DeliverableExtensions
  ctx.effect(
    () => deliverableExtensions.registerDetector(wanweiDeliverablePaths),
    'wanwei deliverable result protocol',
  )
  ctx.effect(() => deliverableExtensions.registerPresenter({
    claims: path => /(?:-analysis-view_|分析视图_|审查视图_|原始数据_|底稿_)\d{8}_\d{6}_\d{3}\.(?:json|md)$/u.test(path),
    render: (paths, openFile) => {
      const path = paths.find(value => /(?:-analysis-view_|分析视图_|审查视图_)\d{8}_\d{6}_\d{3}\.json$/u.test(value))
      if (path === undefined) return null
      const readView = async (viewPath: string): Promise<unknown> => {
        return invokeDesktop('read_analysis_view', { path: viewPath })
      }
      return (
        <AnalysisResultCard
          path={path}
          openFile={openFile}
          excelPath={paths.find(value => /\.xlsx$/iu.test(value))}
          wordPath={paths.find(value => /\.docx$/iu.test(value))}
          readView={readView}
        />
      )
    },
  }), 'wanwei analysis result presenter')
  ctx.effect(() => platformActions.register({
    openDirectory: async (path) => {
      await invokeDesktop('open_workspace_directory', { workspacePath: path })
    },
    saveFile: async ({ filename, bytes }) => {
      const path = await invokeDesktop('save_session_log_archive', { fileName: filename, bytes: [...bytes] })
      if (typeof path !== 'string' || path === '') throw new Error(productText('下载未返回有效的文件路径'))
      try {
        await invokeDesktop('reveal_downloaded_file', { filePath: path })
        return { path }
      } catch (reason) {
        return { path, warning: productText('文件已保存，但无法打开目录：{0}', [reason instanceof Error ? reason.message : String(reason)]) }
      }
    },
  }), 'wanwei product shell actions')
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand', () =>
        ctx.slots.inject('conversation.hero.brand.mark', function* () {
          yield ctx.slots.register({ name: 'sidebar.brand.mark', priority: -100 }, WanweiBrandMark)
          yield ctx.slots.register({ name: 'sidebar.brand.name', priority: -100 }, WanweiBrandName)
          yield ctx.slots.register({ name: 'conversation.hero.brand', priority: -100 }, WanweiHeroBrand)
          yield ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -100 }, WanweiBrandMark)
        }))))
  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register({ name: 'conversation.input.left', id: 'wanwei-file-import', order: -100 }, FileImportAction))
  ctx.inject(['conversation'], (scope: Context) => {
    const input = (scope.get('conversation') as IConversation).input
    const actions: Pick<InputActions, 'appendReferences'> = {
      appendReferences: (references) => {
        if (input.stagedSubmission.getSnapshot().busy) return false
        input.setStagedDraft([input.stagedDraft.getSnapshot(), ...references.map(reference => reference.ref)].filter(Boolean).join(' '))
        return true
      },
    }
    scope.slots.inject('conversation.composer.tools', () => scope.slots.register({
      name: 'conversation.composer.tools', id: 'wanwei-draft-file-import', order: -100,
    }, function DraftFileImport(props: PropsRuntime<'conversation.composer.tools'>) {
      if (props.sessionId !== undefined) return null
      return <FileImportAction {...props} inputActions={actions} />
    }))
  })
}
