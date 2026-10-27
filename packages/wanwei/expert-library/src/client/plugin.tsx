import { createPanelController, registerFeaturePanel } from '@deepseek-ai/dsh-wanwei-feature-panels/client'
import type { Context } from '@deepseek-ai/cordis'
import './page.css'
import type { RpcResult, ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import { ExpertMarket } from './ExpertMarket.tsx'
import type { RemoteExpert } from './expert-catalog.ts'
import { productText } from './locales/product.ts'
export { ExpertMarket } from './ExpertMarket.tsx'
type DesktopBridge = { core?: { invoke?: (command: string, argumentsValue?: unknown) => Promise<unknown> } }

type DesktopInternals = { invoke?: (command: string, argumentsValue?: unknown) => Promise<unknown> }

function rpcValue(result: RpcResult<unknown>): unknown {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
function ExpertsIcon({ size = 18 }: { size?: number }) {
  const shared = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }


  return <svg {...shared}><circle cx="12" cy="7" r="3" /><path d="M6.5 20c.4-3.4 2.2-5.2 5.5-5.2s5.1 1.8 5.5 5.2" /><circle cx="5" cy="10" r="2" /><path d="M2 18c.2-2.1 1.1-3.4 3-3.9" /><circle cx="19" cy="10" r="2" /><path d="M22 18c-.2-2.1-1.1-3.4-3-3.9" /></svg>
}

export const inject = ['slots', 'connection', 'layout', 'wanweiNetwork']
/** Mount only the expert catalog and native expert workbenches.
 * @param ctx - Product Client context.
 */
export function apply(ctx: Context): void {
  const controller = createPanelController(ctx, 'wanwei-expert-library')
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const layout = ctx.get('layout') as ILayout
  const loadExperts = async () => {
    const raw = rpcValue(await connection.rpc.call('/desktop-auth', 'expert-list', {})) as { items?: unknown }
    return Array.isArray(raw.items) ? raw.items.filter((item): item is RemoteExpert => typeof item === 'object' && item !== null) : []
  }
  const launchExpert = async (key: string) => {
    const raw = rpcValue(await connection.rpc.call('/desktop-auth', 'expert-launch', { key })) as { url?: unknown; ticket?: unknown }
    if (typeof raw.url !== 'string' || typeof raw.ticket !== 'string') throw new Error('专家打开信息无效')
    return { url: raw.url, ticket: raw.ticket }
  }
  const prepareExpertWorkspace = async () => {
    layout.closeSidebar()
    const desktopWindow = window as Window & { __TAURI__?: DesktopBridge; __TAURI_INTERNALS__?: DesktopInternals }
    const invoke = desktopWindow.__TAURI__?.core?.invoke ?? desktopWindow.__TAURI_INTERNALS__?.invoke
    if (typeof invoke === 'function') await invoke('maximize_expert_window', {})
  }
  registerFeaturePanel(ctx, 'skill-experts', 30, { controller, title: productText('专家库'),
    subtitle: productText('为自然资源与政企协同场景匹配专业智能角色'), Icon: ExpertsIcon,
    hooks: { network: ctx.wanweiNetwork },
    renderContent: () => <ExpertMarket network={ctx.wanweiNetwork} loadExperts={loadExperts} launchExpert={launchExpert}
      prepareExpertWorkspace={prepareExpertWorkspace} />,
  })
}
