import { createPanelController, registerFeaturePanel, Toast, type WanweiNotice } from '@deepseek-ai/dsh-wanwei-feature-panels/client'
import type { Context } from '@deepseek-ai/cordis'
import { useState } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AutomationSnapshot } from '../contract.ts'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import './page.css'
import './task-cards.css'
import './task-editor.css'
import { AutomationCards, type AutomationApi } from './task-cards.tsx'
import { productText } from './locales/product.ts'
import { startAutomationConversation } from './task-draft.ts'

function AutomationsIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.8 2" />
  </svg>
}

function AutomationPage({ api }: { api: AutomationApi }) {
  const [notice, setNotice] = useState<WanweiNotice | null>(null)
  return <><AutomationCards api={api} notify={(text) => { setNotice({ kind: 'info', text }) }} />
    <Toast notice={notice} setNotice={setNotice} /></>
}

export const inject = ['slots', 'wanweiNetwork', 'connection', 'sessions', 'conversation', 'workspaces', 'remote', 'remote.directoryPicker', 'remote.session']
/** Mount the persistent local scheduler UI.
 * @param ctx - Product Client context.
 */
export function apply(ctx: Context): void {
  const controller = createPanelController(ctx, 'wanwei-automations')
  const connection = ctx.get('connection') as ConnectionHandle
  const api: AutomationApi = {
    async call(operation, payload, signal) {
      const result = await connection.rpc.call('/desktop-automations', operation, payload, signal)
      if (!result.ok) throw new Error(result.error.message)
      return result.value as AutomationSnapshot
    },
    openSession(id) { controller.close(); ctx.sessions.open(SessionId(id)) },
    fromTask() {
      startAutomationConversation(ctx.conversation.input, ctx.sessions, () => { controller.close() })
    },
    listWorkspaces() {
      return Promise.resolve(ctx.workspaces.list.getSnapshot().items.map(item => ({ title: item.title, path: item.path })))
    },
    async chooseDirectory() {
      const result = await ctx.remote.directoryPicker.pick()
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    async listModels() {
      const result = await ctx.remote.session.modelCatalog()
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    async listConnectors() {
      const result = await connection.rpc.call('/wanwei-connectors', 'options', {})
      if (!result.ok) throw new Error(result.error.message)
      if (!Array.isArray(result.value) || result.value.some((item: unknown) => {
        if (!item || typeof item !== 'object') return true
        const row = item as Record<string, unknown>
        return !['feishu', 'dingtalk', 'wechat'].includes(String(row.id))
          || typeof row.name !== 'string' || typeof row.icon !== 'string' || typeof row.connected !== 'boolean'
      })) throw new Error(productText('连接器状态加载失败'))
      return result.value as Awaited<ReturnType<NonNullable<AutomationApi['listConnectors']>>>
    },
  }
  registerFeaturePanel(ctx, 'skill-automations', 10, {
    controller, title: productText('自动化'),
    subtitle: productText('配置本机定时任务，查看执行记录'),
    requiresDirectInternet: true,
    visibility: ctx.wanweiNetwork.visibility('automations'), Icon: AutomationsIcon,
    hooks: { network: ctx.wanweiNetwork }, renderContent: () => <AutomationPage api={api} />,
  })
}
