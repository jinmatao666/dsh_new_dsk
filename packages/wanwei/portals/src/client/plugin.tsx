import { createPanelController, registerFeaturePanel } from '@deepseek-ai/dsh-wanwei-feature-panels/client'
import type { Context } from '@deepseek-ai/cordis'
import { useEffect, useState, useSyncExternalStore, type ComponentType } from 'react'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-wanwei-oneapi-auth/client'
import './page.css'
import { productText } from './locales/product.ts'

type PortalFeature = 'landMarket' | 'policyEncyclopedia'

type DesktopBridge = { core?: { invoke?: (command: string, argumentsValue?: unknown) => Promise<unknown> } }
type DesktopInternals = { invoke?: (command: string, argumentsValue?: unknown) => Promise<unknown> }

async function maximizeDesktopWindow(): Promise<void> {
  const desktopWindow = window as Window & { __TAURI__?: DesktopBridge; __TAURI_INTERNALS__?: DesktopInternals }
  const invoke = desktopWindow.__TAURI__?.core?.invoke ?? desktopWindow.__TAURI_INTERNALS__?.invoke
  if (typeof invoke === 'function') await invoke('maximize_expert_window', {})
}

function LandMarketIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 21h18" /><path d="M5 21V10l7-5 7 5v11" /><path d="M9 21v-6h6v6" />
  </svg>
}

function PolicyEncyclopediaIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 19.5V6.2A2.2 2.2 0 0 1 6.2 4H14l6 6v9.5A2.2 2.2 0 0 1 17.8 22H6.2A2.2 2.2 0 0 1 4 19.5Z" />
    <path d="M14 4v6h6" /><path d="M8 13h8" /><path d="M8 17h5" />
  </svg>
}

/** Centered loading mark matching knowledge-base ViewerLoading visuals.
 * @param props - Accessible status label.
 */
function PortalLoading({ label }: { label: string }) {
  return <div className="dsh-portal-loading" role="status" aria-label={label}>
    <span className="dsh-portal-loading-mark" aria-hidden="true">
      <span className="dsh-portal-loading-core" />
    </span>
  </div>
}

/** Embed the administrator-configured page URL, or show the empty-config placeholder.
 * @param props - Live feature-page URL observable from wanweiNetwork.
 */
export function PortalPage({ url }: { url: HostObservable<string> }) {
  const href = useSyncExternalStore(url.subscribe, url.getSnapshot)
  const [loading, setLoading] = useState(Boolean(href))
  useEffect(() => {
    setLoading(Boolean(href))
  }, [href])
  if (!href) {
    return <div className="dsh-portal-empty" role="status">
      <h2>{productText('请先在管理工作台配置页面地址')}</h2>
      <p>{productText('管理员尚未配置此功能的页面地址，配置后即可在此查看。')}</p>
    </div>
  }
  return <div className="dsh-portal-frame-host">
    {loading ? <PortalLoading label={productText('正在加载…')} /> : null}
    <iframe
      className="dsh-portal-frame"
      title={href}
      src={href}
      referrerPolicy="no-referrer"
      onLoad={() => setLoading(false)}
    />
  </div>
}

function registerPortal(
  ctx: Context,
  options: {
    id: string
    order: number
    feature: PortalFeature
    title: string
    subtitle: string
    Icon: ComponentType<{ size?: number }>
  },
): void {
  const controller = createPanelController(ctx, options.id)
  const layout = ctx.get('layout') as ILayout
  ctx.effect(() => controller.subscribe(({ open }) => {
    if (!open) return
    layout.closeSidebar()
    void maximizeDesktopWindow().catch((error) => {
      console.error(`${options.id}: maximize failed`, error)
    })
  }), `${options.id}: maximize on open`)
  registerFeaturePanel(ctx, options.id, options.order, {
    controller,
    title: options.title,
    subtitle: options.subtitle,
    visibility: ctx.wanweiNetwork.visibility(options.feature),
    Icon: options.Icon,
    hooks: { network: ctx.wanweiNetwork },
    bodyClassName: 'dsh-portal-host',
    headerChrome: 'back-only',
    renderContent: () => <PortalPage url={ctx.wanweiNetwork.featurePageUrl(options.feature)} />,
  })
}

export const inject = ['slots', 'layout', 'wanweiNetwork']

/** Mount land-market and policy-encyclopedia portal panels.
 * @param ctx - Product Client context.
 */
export function apply(ctx: Context): void {
  registerPortal(ctx, {
    id: 'skill-land-market',
    order: 40,
    feature: 'landMarket',
    title: productText('土地市场'),
    subtitle: productText('浏览配置的土地市场页面'),
    Icon: LandMarketIcon,
  })
  registerPortal(ctx, {
    id: 'skill-policy-encyclopedia',
    order: 45,
    feature: 'policyEncyclopedia',
    title: productText('政策宝典'),
    subtitle: productText('浏览配置的政策宝典页面'),
    Icon: PolicyEncyclopediaIcon,
  })
}
