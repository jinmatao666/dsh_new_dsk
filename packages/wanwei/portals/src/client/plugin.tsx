import { createPanelController, registerFeaturePanel } from '@deepseek-ai/dsh-wanwei-feature-panels/client'
import type { Context } from '@deepseek-ai/cordis'
import { useEffect, useState, useSyncExternalStore, type ComponentType } from 'react'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ConnectionHandle, RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-wanwei-oneapi-auth/client'
import './page.css'
import { productText } from './locales/product.ts'
import { withPortalTicket } from './ticket.ts'

type PortalFeature = 'landMarket' | 'planningLecture' | 'policyEncyclopedia'
type TicketLaunchEndpoint = 'land-market-launch' | 'planning-lecture-launch'

type DesktopBridge = { core?: { invoke?: (command: string, argumentsValue?: unknown) => Promise<unknown> } }
type DesktopInternals = { invoke?: (command: string, argumentsValue?: unknown) => Promise<unknown> }

function rpcValue(result: RpcResult<unknown>): unknown {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

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

function PlanningLectureIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="m10 7 5 3-5 3V7Zm2 9v5m-5 0h10" />
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
 * Ticketed portals request a single-use desktop ticket before loading the iframe.
 * @param props - Live feature-page URL observable and optional launch callback.
 */
export function PortalPage({
  url,
  launchWithTicket,
}: {
  url: HostObservable<string>
  launchWithTicket?: () => Promise<{ url: string; ticket: string }>
}) {
  const configured = useSyncExternalStore(url.subscribe, url.getSnapshot)
  const [href, setHref] = useState(launchWithTicket === undefined ? configured : '')
  const [loading, setLoading] = useState(Boolean(configured))

  useEffect(() => {
    let cancelled = false
    if (!configured) {
      setHref('')
      setLoading(false)
      return
    }
    if (launchWithTicket === undefined) {
      setHref(configured)
      setLoading(true)
      return
    }
    setLoading(true)
    setHref('')
    void launchWithTicket().then((launch) => {
      if (cancelled) return
      setHref(withPortalTicket(launch.url || configured, launch.ticket))
    }).catch((err: unknown) => {
      if (cancelled) return
      console.error('portal launch ticket failed', err)
      setHref(configured)
    })
    return () => { cancelled = true }
  }, [configured, launchWithTicket])

  if (!configured) {
    return <div className="dsh-portal-empty" role="status">
      <h2>{productText('请先在管理工作台配置页面地址')}</h2>
      <p>{productText('管理员尚未配置此功能的页面地址，配置后即可在此查看。')}</p>
    </div>
  }
  if (!href) {
    return <div className="dsh-portal-frame-host">
      <PortalLoading label={productText('正在加载…')} />
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
    launchWithTicket?: () => Promise<{ url: string; ticket: string }>
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
  registerFeaturePanel(ctx, options.id, ctx.wanweiNetwork.sidebarOrder(options.feature), {
    controller,
    title: options.title,
    subtitle: options.subtitle,
    visibility: ctx.wanweiNetwork.visibility(options.feature),
    Icon: options.Icon,
    hooks: { network: ctx.wanweiNetwork },
    bodyClassName: 'dsh-portal-host',
    headerChrome: 'back-only',
    renderContent: () => <PortalPage
      url={ctx.wanweiNetwork.featurePageUrl(options.feature)}
      {...(options.launchWithTicket === undefined
        ? {}
        : { launchWithTicket: options.launchWithTicket })}
    />,
  })
}

export const inject = ['slots', 'layout', 'wanweiNetwork', 'connection']

/** Mount the land market, planning lecture and policy encyclopedia panels.
 * @param ctx - Product Client context.
 */
export function apply(ctx: Context): void {
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const launchPortal = (endpoint: TicketLaunchEndpoint) => async () => {
    const raw = rpcValue(await connection.rpc.call('/desktop-auth', endpoint, {})) as {
      url?: unknown
      ticket?: unknown
    }
    if (typeof raw.url !== 'string' || typeof raw.ticket !== 'string') throw new Error('页面打开信息无效')
    return { url: raw.url, ticket: raw.ticket }
  }
  registerPortal(ctx, {
    id: 'skill-land-market',
    order: 40,
    feature: 'landMarket',
    title: productText('土地市场'),
    subtitle: productText('浏览配置的土地市场页面'),
    Icon: LandMarketIcon,
    launchWithTicket: launchPortal('land-market-launch'),
  })
  registerPortal(ctx, {
    id: 'skill-planning-lecture',
    order: 42,
    feature: 'planningLecture',
    title: productText('资规讲坛'),
    subtitle: productText('浏览配置的资规讲坛页面'),
    Icon: PlanningLectureIcon,
    launchWithTicket: launchPortal('planning-lecture-launch'),
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
