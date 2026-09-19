import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { Context } from '@deepseek-ai/cordis'
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

function fileMention(path: string): string {
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) throw new Error('导入后的文件路径包含不支持的字符')
  return /\s/u.test(path) ? `@"${path}"` : `@${path}`
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
  const invoke = window.__ZJUGIS_NATIVE_INVOKE__
  if (invoke === undefined) throw new Error('桌面端文件服务暂时不可用')
  const payload = files === undefined ? undefined : await Promise.all(files.map(async file => ({
    name: file.name,
    bytes: [...new Uint8Array(await file.arrayBuffer())],
  })))
  const result = await invoke(command, {
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
    const browserDrop = (event: Event) => {
      const files = (event as CustomEvent<{ files?: readonly File[] }>).detail.files
      if (files === undefined) return
      void importFiles(files)
    }
    const drop = () => {
      if (busy) return
      setBusy(true)
      setError(undefined)
      window.dispatchEvent(new CustomEvent('dsh:native-file-import-status', {
        detail: { text: '正在导入文件…', error: false },
      }))
      void nativeImport('import_dropped_workspace_files', workspacePath)
        .then((paths) => {
          append(paths)
          window.dispatchEvent(new CustomEvent('dsh:native-file-import-status', {
            detail: { text: `已导入 ${paths.length} 个文件`, error: false },
          }))
        })
        .catch((reason: unknown) => {
          const message = reason instanceof Error ? reason.message : String(reason)
          setError(message)
          window.dispatchEvent(new CustomEvent('dsh:native-file-import-status', {
            detail: { text: `文件导入失败：${message}`, error: true },
          }))
        })
        .finally(() => { setBusy(false) })
    }
    window.addEventListener('dsh:browser-file-drop', browserDrop)
    window.addEventListener('dsh:native-file-drop', drop)
    return () => {
      window.removeEventListener('dsh:browser-file-drop', browserDrop)
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
    <img
      className="wanwei-product-hero-brand"
      src="/brand-wordmark.svg"
      width={244}
      height={61}
      alt="万维 Buddy"
    />
  )
}

export const inject = ['slots']

/** Installs only Wanwei-owned occupants; official DSH packages stay untouched. */
export function apply(ctx: Context): void {
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
