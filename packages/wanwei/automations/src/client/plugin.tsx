import { createPanelController, registerFeaturePanel, Toast, type WanweiNotice } from '@deepseek-ai/dsh-wanwei-feature-panels/client'
import type { Context } from '@deepseek-ai/cordis'
import { useState } from 'react'
import './page.css'
import './task-cards.css'
import { AutomationCards } from './task-cards.tsx'
import { productText } from './locales/product.ts'

function AutomationsIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.8 2" />
  </svg>
}

function AutomationPage() {
  const [notice, setNotice] = useState<WanweiNotice | null>(null)
  return <><AutomationCards notify={(text) => { setNotice({ kind: 'info', text }) }} />
    <Toast notice={notice} setNotice={setNotice} /></>
}

export const inject = ['slots', 'wanweiNetwork']
/** Mount the desktop card preview without starting a scheduler.
 * @param ctx - Product Client context.
 */
export function apply(ctx: Context): void {
  const controller = createPanelController(ctx, 'wanwei-automations')
  registerFeaturePanel(ctx, 'skill-automations', 10, {
    controller, title: productText('自动化'),
    subtitle: productText('配置本机定时任务，查看执行记录'), blockedIntranet: true,
    visibility: ctx.wanweiNetwork.visibility('automations'), Icon: AutomationsIcon,
    hooks: { network: ctx.wanweiNetwork }, renderContent: () => <AutomationPage />,
  })
}
