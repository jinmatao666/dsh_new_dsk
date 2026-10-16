/** Shared presentation and reversible navigation for independently mounted product pages. */
import { useEffect, useSyncExternalStore } from 'react'
import type { ComponentType, ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { NetworkState } from '@deepseek-ai/dsh-wanwei-oneapi-auth/client'
import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { isMarketInteraction } from './market-interaction.ts'
import { productText } from './locales/product.ts'
import './panels.css'

export { Toast, isNoticeTarget } from './Toast.tsx'
export type { WanweiNotice } from './Toast.tsx'
export { isMarketInteraction } from './market-interaction.ts'

/** State belongs to one plugin instance, not a global registry of feature pages. */
export interface PanelController {
  open(this: void): void
  close(this: void): void
  toggle(this: void): void
  isOpen(this: void): boolean
  subscribe(this: void, listener: (state: { open: boolean }) => void): () => void
}

/** Allocate navigation state and bind its listeners to the mounting plugin's lifetime.
 * @param ctx - Mounting plugin context.
 * @param id - Unique sidebar capability identifier.
 * @returns Instance-owned controller; disposal closes the page and detaches listeners.
 */
export function createPanelController(ctx: Context, id: string): PanelController {
  const listeners = new Set<(state: { open: boolean }) => void>()
  let open = false
  let disposed = false
  const setOpen = (value: boolean) => {
    if (disposed || open === value) return
    open = value
    listeners.forEach((listener) => {
      try { listener({ open }) }
      catch (error) { console.error(`${id}: panel subscriber failed`, error) }
    })
    if (open) window.dispatchEvent(new CustomEvent('wanwei:feature-open', { detail: id }))
  }
  const controller: PanelController = {
    open: () => { setOpen(true) },
    close: () => { setOpen(false) },
    toggle: () => { setOpen(!open) },
    isOpen: () => open,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  ctx.effect(() => {
    const onNavigation = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) controller.close()
    }
    const onAuth = (event: Event) => {
      if ((event as CustomEvent<{ authenticated?: boolean } | undefined>).detail?.authenticated === false) controller.close()
    }
    window.addEventListener('wanwei:feature-open', onNavigation)
    window.addEventListener('wanwei:auth-state', onAuth)
    return () => {
      controller.close()
      disposed = true
      listeners.clear()
      window.removeEventListener('wanwei:feature-open', onNavigation)
      window.removeEventListener('wanwei:auth-state', onAuth)
    }
  }, `${id}: panel navigation`)
  return controller
}

/** Product-provided copy, artwork and policy; this library contains no catalogs or remotes. */
export interface PanelInjected {
  controller: PanelController
  title: string
  subtitle: string
  visibility?: HostObservable<boolean>
  Icon: ComponentType<{ size?: number }>
  renderContent: () => ReactNode
  hooks: { network: HostObservable<NetworkState> }
}
export type PanelProps = PropsRuntime<'shell.overlay'> & InjectFace<PanelInjected>
export type PanelActionProps = PropsRuntime<'sidebar.footer.action'> & SidebarFooterActionOwnerProps & InjectFace<PanelInjected>

/** Shared sidebar presentation; the owning plugin supplies its policy and controller.
 * @param props - Slot runtime and feature presentation.
 * @returns Sidebar action.
 */
export function PanelAction({ wide, title, Icon, controller, visibility }: PanelActionProps) {
  const visible = useSyncExternalStore(
    listener => visibility ? visibility.subscribe(listener) : () => {}, () => visibility ? visibility.getSnapshot() : true,
  )
  const open = useSyncExternalStore(controller.subscribe, controller.isOpen)
  if (!visible) return null
  return <button type="button" className={`dsh-skill-market-action${wide ? '' : ' rail'}${open ? ' active' : ''}`}
    aria-label={title} aria-expanded={open} title={title}
    onClick={() => { controller.toggle() }}>
    <Icon size={wide ? 16 : 18} />{wide && <span>{title}</span>}
  </button>
}

/** Close on sidebar navigation, but preserve state during resizing and owned dropdown interactions.
 * @param controller - Owning plugin's controller.
 * @param open - Current panel visibility.
 */
export function usePanelNavigation(controller: PanelController, open: boolean): void {
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Element && !isMarketInteraction(event.target)) controller.close()
    }
    document.addEventListener('pointerdown', onPointer, true)
    return () => { document.removeEventListener('pointerdown', onPointer, true) }
  }, [controller, open])
}

/** Common page chrome; feature components own their business state and network operations.
 * @param props - Runtime visibility, policy and feature content.
 * @returns Visible page or no overlay.
 */
export function FeaturePanel({ title, subtitle, controller, renderContent, visibility }: PanelProps) {
  const visible = useSyncExternalStore(
    listener => visibility ? visibility.subscribe(listener) : () => {}, () => visibility ? visibility.getSnapshot() : true,
  )
  const open = useSyncExternalStore(controller.subscribe, controller.isOpen)
  usePanelNavigation(controller, open)
  useEffect(() => { if (!visible) controller.close() }, [controller, visible])
  if (!open || !visible) return null
  return <div className="dsh-skill-market-overlay" role="dialog" aria-modal="true" aria-label={title}>
    <div className="dsh-skill-market-panel">
      <header className="dsh-skill-market-header">
        <div className="dsh-skill-market-heading"><span className="dsh-skill-kicker">{productText('WANWEI Buddy')}</span>
          <h1>{title}</h1><p>{subtitle}</p></div>
        <button type="button" className="dsh-skill-close" aria-label={productText('返回')} onClick={() => { controller.close() }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
          </svg>
        </button>
      </header>
      {renderContent()}
    </div>
  </div>
}

/** Mount one feature without registering any other feature's entry or content.
 * @param ctx - Owning plugin context with slot services.
 * @param id - Stable feature registration identifier.
 * @param order - Sidebar order.
 * @param injected - Feature presentation and controller.
 */
export function registerFeaturePanel(ctx: Context, id: string, order: number, injected: PanelInjected): void {
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    { name: 'sidebar.footer.action', id, order, inject: () => injected }, PanelAction,
  ))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: `${id}-panel`, order: 100 + order, inject: () => injected }, FeaturePanel,
  ))
}
