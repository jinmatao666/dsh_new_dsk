/** Reuse connector authorization panels without leaving the automation draft. */
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { createDingTalkApi } from './dingtalk-api.ts'
import { createWeChatApi } from './wechat-api.ts'
import { createFeishuApi, FeishuPanel } from './FeishuPanel.tsx'
import { DingTalkPanel } from './DingTalkPanel.tsx'
import { WeChatPanel } from './WeChatPanel.tsx'
import './page.css'

/** Authorization uses the same RPC, credentials and panels as the connector page.
 * @param props - Existing connection, chosen channel and completion callback.
 * @returns Owned modal above the task editor, or nothing after completion.
 */
export function NotificationConnectionDialog({ connection, channel, complete }: {
  connection: ConnectionHandle
  channel: string
  complete: (connected: boolean) => void
}) {
  const dingTalk = useMemo(() => createDingTalkApi(connection), [connection])
  const weChat = useMemo(() => createWeChatApi(connection), [connection])
  const feishu = useMemo(() => createFeishuApi(connection), [connection])
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let disposed = false
    let busy = false
    const refresh = async () => {
      if (busy) return
      busy = true
      try {
        const connected = channel === 'feishu' ? await feishu.call('status').then(v => v.authed && !v.authorizing && v.missingScopes.length === 0 && v.bridge.state === 'ready')
          : channel === 'dingtalk' ? await dingTalk.status().then(v => v.authed && v.skillInstalled)
            : await weChat.status().then(v => v.authed)
        if (!disposed && connected) complete(true)
      } catch { /* The existing panel presents authorization errors and retry. */ }
      finally { busy = false }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 1500)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); complete(false) } }
    window.addEventListener('keydown', escape, true)
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('keydown', escape, true) }
  }, [channel, dingTalk, weChat, feishu, complete])
  const name = channel === 'feishu' ? '飞书' : channel === 'dingtalk' ? '钉钉' : '微信助理'
  return createPortal(<div className="dsh-connector-modal-backdrop" data-dsh-select-owner="automation-authorization-owner" style={{ zIndex: 2000 }}>
    <section className="dsh-connector-detail" role="dialog" aria-modal="true" aria-label={name}>
      <header><h2>{name}</h2><button type="button" aria-label="关闭连接页面" onClick={() =>{  complete(false) }}>×</button></header>
      <p role="status">{name}尚未连接，请先完成连接，成功后将自动开启消息推送。</p>
      {notice && <p role="status">{notice}</p>}
      {channel === 'feishu' ? <FeishuPanel api={feishu} onStatus={() => {}} onTry={() => {}} /> : channel === 'dingtalk'
        ? <DingTalkPanel api={dingTalk} onNotice={(value) =>{  setNotice(value.text) }} onTry={() => {}} />
        : <WeChatPanel api={weChat} onNotice={(value) =>{  setNotice(value.text) }} onTry={() => {}} />}
    </section>
  </div>, document.body)
}
