import { productText } from './locales/product.ts'
import { useEffect, useRef } from 'react'

export type ExpertLaunch = { id: string; name: string; url: string; ticket: string }

function webviewBounds(element: HTMLDivElement | null) {
  const rect = element?.getBoundingClientRect()
  if (rect === undefined) return undefined
  return {
    x: Math.max(0, Math.floor(rect.x)),
    y: Math.max(0, Math.floor(rect.y)),
    width: Math.floor(rect.width),
    height: Math.floor(rect.height),
  }
}

function invokeNative(command: string, args: Record<string, unknown>): Promise<unknown> {
  const invoke = (window as Window & {
    __ZJUGIS_NATIVE_INVOKE__?: (name: string, value: unknown) => Promise<unknown>
  }).__ZJUGIS_NATIVE_INVOKE__
  if (invoke === undefined) return Promise.reject(new Error('请在万维 Buddy 桌面端打开专家'))
  return invoke(command, args)
}

function hasBlockingDialog(holder: HTMLDivElement | null): boolean {
  if (holder === null) return false
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], dialog[open]'))
    .some(dialog => !dialog.contains(holder) && dialog.getClientRects().length > 0)
}

/** The native view is a sibling of the main DSH WebView; presentation rerenders preserve its session. */
export function ExpertWebview({ launch, visible, onError }: {
  launch: ExpertLaunch
  visible: boolean
  onError: (message: string) => void
}) {
  const holder = useRef<HTMLDivElement>(null)
  const viewLabel = useRef<string | undefined>(undefined)
  const nativeVisible = useRef<boolean | undefined>(undefined)
  const syncView = useRef<() => void>(() => {})
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const { id, url, ticket } = launch
  useEffect(() => {
    const panel = holder.current?.closest('.dsh-skill-market-panel')
    panel?.classList.toggle('dsh-expert-view-open', visible)
    return () => { panel?.classList.remove('dsh-expert-view-open') }
  }, [visible])
  useEffect(() => {
    let cancelled = false
    viewLabel.current = undefined
    nativeVisible.current = undefined
    const update = () => {
      const label = viewLabel.current
      if (label === undefined) return
      const shouldShow = visibleRef.current && !hasBlockingDialog(holder.current)
      if (nativeVisible.current !== shouldShow) {
        nativeVisible.current = shouldShow
        void invokeNative('set_expert_webview_visible', { label, visible: shouldShow })
          .catch((error: unknown) => { if (!cancelled) onErrorRef.current(error instanceof Error ? error.message : String(error)) })
      }
      const value = webviewBounds(holder.current)
      if (shouldShow && value !== undefined) {
        void invokeNative('set_expert_webview_bounds', { label, ...value })
          .catch((error: unknown) => { if (!cancelled) onErrorRef.current(error instanceof Error ? error.message : String(error)) })
      }
    }
    syncView.current = update
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
    if (holder.current !== null) observer?.observe(holder.current)
    window.addEventListener('resize', update)
    // A scroll changes the holder's position without changing its size.
    document.addEventListener('scroll', update, true)
    // Native child Webviews sit above HTML overlays; hide them while a separate modal is open.
    const dialogs = new MutationObserver(update)
    dialogs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'style', 'class', 'aria-modal'] })
    const value = webviewBounds(holder.current)
    if (value !== undefined) {
      void invokeNative('open_expert_webview', { ...value, key: id, url, ticket })
        .then((result) => {
          if (typeof result !== 'string') throw new Error('专家视图返回了无效标识')
          if (cancelled) {
            void invokeNative('close_expert_webview', { label: result })
            return
          }
          viewLabel.current = result
          update()
        })
        .catch((error: unknown) => { if (!cancelled) onErrorRef.current(error instanceof Error ? error.message : String(error)) })
    }
    return () => {
      cancelled = true
      observer?.disconnect()
      dialogs.disconnect()
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', update, true)
      syncView.current = () => {}
      if (viewLabel.current !== undefined) void invokeNative('close_expert_webview', { label: viewLabel.current })
    }
  }, [id, url, ticket])
  useEffect(() => {
    syncView.current()
  }, [visible])
  return <div ref={holder} className="dsh-expert-webview" aria-label={productText('{0}工作台', [launch.name])} style={{ display: visible ? undefined : 'none' }} />
}
