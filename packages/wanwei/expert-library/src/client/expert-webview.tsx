import { productText } from './locales/product.ts'
import { useEffect, useRef } from 'react'

export type ExpertLaunch = { id: string; name: string; url: string; ticket: string }

function webviewBounds(element: HTMLDivElement | null) {
  const rect = element?.getBoundingClientRect()
  if (rect === undefined) return undefined
  // The native child rejects smaller views. Layout may still be settling after
  // the marketplace panel opens or the desktop window is maximized on macOS.
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)
    || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)
    || rect.width < 200 || rect.height < 200) return undefined
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
  const syncView = useRef<() => void>(() => {})
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const { id, url, ticket } = launch
  useEffect(() => {
    let cancelled = false
    let label: string | undefined
    let nativeVisible: boolean | undefined
    let dirty = false
    let pending: Promise<void> | undefined
    const isCancelled = () => cancelled
    const needsUpdate = () => dirty && !isCancelled()
    const shouldShow = () => visibleRef.current && webviewBounds(holder.current) !== undefined
      && !hasBlockingDialog(holder.current)
    const update = () => {
      if (cancelled) return
      dirty = true
      if (pending !== undefined) return
      pending = (async () => {
        while (needsUpdate()) {
          dirty = false
          const value = webviewBounds(holder.current)
          const show = shouldShow()
          if (label === undefined) {
            if (!show || value === undefined) continue
            const result = await invokeNative('open_expert_webview', { ...value, key: id, url, ticket })
            if (typeof result !== 'string') throw new Error('专家视图返回了无效标识')
            label = result
            // Creation can finish after navigation or a resize. Re-read layout
            // before ever showing the newly created, initially hidden child.
            dirty = true
            continue
          }
          if (show && value !== undefined) {
            await invokeNative('set_expert_webview_bounds', { label, ...value })
            if (isCancelled()) break
            if (!shouldShow()) { dirty = true; continue }
          }
          if (nativeVisible !== show) {
            await invokeNative('set_expert_webview_visible', { label, visible: show })
            nativeVisible = show
          }
        }
      })().catch((error: unknown) => {
        dirty = false
        nativeVisible = undefined
        if (!cancelled) onErrorRef.current(error instanceof Error ? error.message : String(error))
      }).finally(() => {
        pending = undefined
        if (dirty && !cancelled) update()
      })
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
    update()
    return () => {
      cancelled = true
      observer?.disconnect()
      dialogs.disconnect()
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', update, true)
      syncView.current = () => {}
      // Drain outstanding create/show/bounds calls before cleanup, so a late
      // show can never resurrect an unmounted view over another feature page.
      void (async () => {
        await pending
        if (label === undefined) return
        try { await invokeNative('set_expert_webview_visible', { label, visible: false }) }
        catch { /* Close is the fallback when hiding the owned child fails. */ }
        try { await invokeNative('close_expert_webview', { label }) }
        catch (error) {
          // Closing is idempotent; retry once before reporting a native failure.
          try { await invokeNative('close_expert_webview', { label }) }
          catch { console.error('专家视图清理失败', error) }
        }
      })()
    }
  }, [id, url, ticket])
  useEffect(() => {
    syncView.current()
  }, [visible])
  return <div ref={holder} className="dsh-expert-webview" aria-label={productText('{0}工作台', [launch.name])} style={{ display: visible ? undefined : 'none' }} />
}
