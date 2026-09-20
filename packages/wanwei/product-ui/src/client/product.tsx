import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ClientPlatformActions } from '@deepseek-ai/dsh-client-platform-actions/client'
import type { DeliverableExtensions } from '@deepseek-ai/dsh-client-ui-deliverables/client'
import { AnalysisResultCard } from './AnalysisResultCard.tsx'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import './theme.css'

type BrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps
type FileImportProps = PropsRuntime<'conversation.input.left'>
type NativeInvoke = (command: string, argumentsValue?: unknown) => Promise<unknown>

declare global {
  interface Window { __ZJUGIS_NATIVE_INVOKE__?: NativeInvoke }
}

function invokeDesktop(command: string, argumentsValue?: unknown): Promise<unknown> {
  const invoke = window.__ZJUGIS_NATIVE_INVOKE__
  if (invoke === undefined) throw new Error('Desktop native capabilities are unavailable')
  return invoke(command, argumentsValue)
}

function fileMention(path: string): string {
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) throw new Error('导入后的文件路径包含不支持的字符')
  return /\s/u.test(path) ? `@"${path}"` : `@${path}`
}

const RESULT_PREFIX = 'WANWEI_RESULT='

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function wanweiDeliverablePaths(text: string): readonly string[] {
  const paths: string[] = []
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trimStart()
    if (trimmed.startsWith(RESULT_PREFIX)) {
      try {
        const value: unknown = JSON.parse(trimmed.slice(RESULT_PREFIX.length))
        if (isRecord(value) && value.success !== false && Array.isArray(value.artifacts)) {
          for (const artifact of value.artifacts) {
            if (isRecord(artifact) && typeof artifact.path === 'string' && artifact.path.trim() !== '') {
              paths.push(artifact.path.trim())
            }
          }
        }
      } catch {
        // A malformed product marker does not hide later valid artifacts.
      }
    }
  }
  for (const match of text.matchAll(/DSH_ANALYSIS_VIEW=([^\r\n]+)/gu)) {
    const path = match[1]?.trim()
    if (path !== undefined && path !== '') paths.push(path)
  }
  return [...new Set(paths)]
}

function useActiveWorkspacePath(props: FileImportProps): string | undefined {
  const workspaces = props.useWorkspaces(value => value.items)
  return workspaces.find(workspace => workspace.sessionIds.includes(props.sessionId))?.path
}

async function nativeImport(
  command: 'import_workspace_files' | 'import_dropped_workspace_files',
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

function FileImportAction(props: FileImportProps) {
  const input = props.useInput(value => value)
  const workspacePath = useActiveWorkspacePath(props)
  const picker = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [dragActive, setDragActive] = useState(false)
  const [status, setStatus] = useState<{ text: string; error: boolean }>()
  const append = (paths: readonly string[]) => {
    const prefix = input.draft === '' || /\s$/u.test(input.draft) ? '' : ' '
    props.inputActions.setDraft(`${input.draft}${prefix}${paths.map(fileMention).join(' ')}`)
  }
  const importFiles = async (files: readonly File[]) => {
    if (files.length === 0 || busy) return
    setBusy(true)
    setError(undefined)
    try { append(await nativeImport('import_workspace_files', workspacePath, files)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  useEffect(() => {
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
      if (busy) return
      setBusy(true)
      setError(undefined)
      setStatus({ text: '正在导入文件…', error: false })
      void nativeImport('import_dropped_workspace_files', workspacePath)
        .then((paths) => {
          append(paths)
          setStatus({ text: `已导入 ${paths.length} 个文件`, error: false })
        })
        .catch((reason: unknown) => {
          const message = reason instanceof Error ? reason.message : String(reason)
          setError(message)
          setStatus({ text: `文件导入失败：${message}`, error: true })
        })
        .finally(() => { setBusy(false) })
    }
    const enter = () => { setDragActive(true) }
    const leave = () => { setDragActive(false) }
    document.addEventListener('drop', browserDrop, { capture: true })
    window.addEventListener('dsh:native-file-drag-enter', enter)
    window.addEventListener('dsh:native-file-drag-leave', leave)
    window.addEventListener('dsh:native-file-drop', drop)
    return () => {
      document.removeEventListener('drop', browserDrop, { capture: true })
      window.removeEventListener('dsh:native-file-drag-enter', enter)
      window.removeEventListener('dsh:native-file-drag-leave', leave)
      window.removeEventListener('dsh:native-file-drop', drop)
    }
  }, [busy, input.draft, workspacePath])
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.currentTarget.files ?? [])]
    event.currentTarget.value = ''
    void importFiles(files)
  }
  return (
    <>
      <input ref={picker} className="wanwei-product-file-input" type="file" multiple onChange={choose} />
      <button className="wanwei-product-file-button" type="button" disabled={busy} title={error ?? '导入文件'} aria-label="导入文件" data-error={error === undefined ? undefined : true} onClick={() => picker.current?.click()}>+</button>
      {dragActive && <div className="wanwei-product-drop-overlay">松开鼠标，将文件导入当前工作区</div>}
      {status !== undefined && <div className="wanwei-product-import-status" data-error={status.error}>{status.text}</div>}
    </>
  )
}

function WanweiBrandMark({ size, className }: BrandMarkProps) {
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
      <img className="wanwei-product-hero-brand" src="/brand-wordmark.svg" width={244} height={61} alt="万维 Buddy" />
      <span className="wanwei-product-hero-badge">专业智能助手</span>
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
      await invokeDesktop('save_session_log_archive', { fileName: filename, bytes: [...bytes] })
    },
  }), 'wanwei product shell actions')
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand', () =>
        ctx.slots.inject('conversation.hero.brand.mark', function* () {
          yield ctx.slots.register({ name: 'sidebar.brand.mark' }, WanweiBrandMark)
          yield ctx.slots.register({ name: 'sidebar.brand.name' }, WanweiBrandName)
          yield ctx.slots.register({ name: 'conversation.hero.brand' }, WanweiHeroBrand)
          yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, WanweiBrandMark)
        }))))
  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register({ name: 'conversation.input.left', id: 'wanwei-file-import', order: -100 }, FileImportAction))
}
