/** Real Feishu, DingTalk and WeChat entries; no local demonstration catalog. */
import { createPanelController, registerFeaturePanel, ServiceUnavailable, Toast, PlusIcon,
  type WanweiNotice } from '@deepseek-ai/dsh-wanwei-feature-panels/client'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { useEffect, useState } from 'react'
import { connectorSessionPreparation, desktopInvoke } from './try-session.ts'
import { removeActiveConnectorId, setActiveConnectorId } from './active-connector.ts'
import { ComposerConnectorChip } from './ComposerConnectorChip.tsx'
import { createDingTalkApi } from './dingtalk-api.ts'
import { DingTalkPanel, DINGTALK_EXAMPLE_PROMPTS, type DingTalkApi } from './DingTalkPanel.tsx'
import { createWeChatApi } from './wechat-api.ts'
import { WeChatPanel, WECHAT_EXAMPLE_PROMPTS, type WeChatApi } from './WeChatPanel.tsx'
import { FeishuPanel, createFeishuApi, type FeishuApi } from './FeishuPanel.tsx'
import { productText as text } from './locales/product.ts'
import './page.css'

const CONNECTORS = [
  { id: 'feishu', name: '飞书', icon: '/connector-icons/feishu.png', accent: '#00aeef',
    summary: text('连接飞书后，可在对话和自动化中使用消息、文档、日历与待办。') },
  { id: 'dingtalk', name: '钉钉', icon: '/connector-icons/dingtalk.png', accent: '#1677ff',
    summary: text('连接钉钉消息、日程、审批与待办，在任务完成后推送结果通知。') },
  { id: 'wechat', name: '微信助理', icon: '/connector-icons/wechat.svg', accent: '#07c160',
    summary: text('通过微信直接下发指令，结果实时回传至微信聊天窗口。') },
] as const

/** Render actual local connector status and authorization panels.
 * @param props - Channel APIs, service check and conversation handoff.
 * @returns Three cards and their connection dialogs.
 */
export function Connectors({ dingTalk, weChat, feishu, onTryPrompt, checkConnection }: {
  dingTalk: DingTalkApi
  weChat: WeChatApi
  feishu?: FeishuApi
  onTryPrompt: (prompt: string, connectorId: string) => void
  checkConnection: () => Promise<unknown>
}) {
  const [connection, setConnection] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [connected, setConnected] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState<WanweiNotice | null>(null)
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    const run = () => {
      void checkConnection().then(() => { if (!disposed) setConnection('ready') }).catch(() => {
        if (disposed) return
        if (++failures >= 3) setConnection('failed')
        timer = setTimeout(run, failures >= 3 ? 1500 : 0)
      })
    }
    run()
    return () => { disposed = true; clearTimeout(timer) }
  }, [checkConnection])
  useEffect(() => {
    let disposed = false
    const remember = (id: string, value: boolean) => {
      if (!disposed) setConnected(current => ({ ...current, [id]: value }))
    }
    void dingTalk.status().then((value) => { remember('dingtalk', value.authed && value.skillInstalled) }).catch(() => { remember('dingtalk', false) })
    void weChat.status().then((value) => { remember('wechat', value.authed) }).catch(() => { remember('wechat', false) })
    if (feishu) void feishu.call('status').then((value) => { remember('feishu', value.authed && !value.authorizing && value.missingScopes.length === 0) }).catch(() => { remember('feishu', false) })
    return () => { disposed = true }
  }, [dingTalk, weChat, feishu, selected])
  const tryPrompt = (id: string, prompt: string) => { setSelected(null); onTryPrompt(prompt, id) }
  if (connection === 'loading') return <p role="status">{text('正在连接服务…')}</p>
  if (connection === 'failed') return <ServiceUnavailable variant="connectors" title={text('暂时无法连接连接器服务')}
    description={text('当前网络无法连接该服务，请检查网络连接或联系管理员。')} />
  const entry = CONNECTORS.find(item => item.id === selected)
  return <section className="dsh-connectors-page">
    <Toast notice={notice} setNotice={setNotice} />
    <div className="dsh-connectors-grid" role="list">{CONNECTORS.map(item => <div role="listitem" key={item.id}
      className={`dsh-connector-card${connected[item.id] ? ' is-connected' : ''}`}>
      <button type="button" className="dsh-connector-card-main" onClick={() => { setSelected(item.id) }}>
        <span className="dsh-connector-brand"><img src={item.icon} width={28} height={28} alt="" /></span>
        <span className="dsh-connector-card-copy"><span className="dsh-connector-card-title"><strong>{item.name}</strong></span>
          <span className="dsh-connector-card-summary">{item.summary}</span></span>
      </button>
      <div className="dsh-connector-card-trail">{connected[item.id] ? <>
        <span className="dsh-connector-status-dot" aria-label={text('已连接')} />
        <button type="button" className="dsh-connector-try" onClick={() => { tryPrompt(item.id,
          item.id === 'feishu' ? text('查看我今天的飞书日程，按时间列出会议和待办')
            : item.id === 'wechat' ? WECHAT_EXAMPLE_PROMPTS[0] : DINGTALK_EXAMPLE_PROMPTS[1]) }}>{text('去试试')}</button>
      </> : <button type="button" className="dsh-connector-add" aria-label={text('连接')}
        onClick={() => { setSelected(item.id) }}><PlusIcon /></button>}</div>
    </div>)}</div>
    {entry && <div className="dsh-connector-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null) }}>
      <section className="dsh-connector-detail" role="dialog" aria-modal="true" aria-label={entry.name}>
        <header><div><span className="dsh-connector-brand"><img src={entry.icon} width={28} height={28} alt="" /></span><h2>{entry.name}</h2></div>
          <button type="button" aria-label={text('关闭')} onClick={() => { setSelected(null) }}>×</button></header>
        {entry.id === 'feishu' && feishu ? <FeishuPanel api={feishu}
          onStatus={(value) => {
            setConnected(current => ({ ...current, feishu: value.authed && !value.authorizing && value.missingScopes.length === 0 }))
          }}
          onTry={(prompt) => { tryPrompt('feishu', prompt) }} />
          : entry.id === 'dingtalk' ? <DingTalkPanel api={dingTalk} onNotice={setNotice} onTry={(prompt) => { tryPrompt('dingtalk', prompt) }} />
            : <WeChatPanel api={weChat} onNotice={setNotice} onTry={(prompt) => { tryPrompt('wechat', prompt) }} />}
      </section>
    </div>}
  </section>
}

function ConnectorsIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m8 12 4 4m-2-10 8 8m-3-11 6 6m-9 3-6 6m-3 3 3-3m9-15-3 3m9 3-3 3" /></svg>
}

export const inject = ['slots', 'connection', 'conversation', 'sessions', 'workspaces', 'wanweiNetwork']
/** Mount independent connector navigation and the shared chat picker.
 * @param ctx - Product Client services.
 */
export function apply(ctx: Context): void {
  const controller = createPanelController(ctx, 'wanwei-connectors')
  const connection = ctx.get('connection') as ConnectionHandle
  const conversation = ctx.get('conversation') as IConversation
  const sessions = ctx.get('sessions') as ISessions
  const workspaces: IWorkspaces = ctx.workspaces
  const dingTalk = createDingTalkApi(connection)
  const weChat = createWeChatApi(connection)
  const feishu = createFeishuApi(connection)
  const checkConnection = () => ctx.wanweiNetwork.refresh()
  const onTryPrompt = (prompt: string, id: string) => {
    setActiveConnectorId(id)
    controller.close()
    if (id === 'wechat') {
      void weChat.ensureSession().then((value) => { sessions.open(SessionId(value.sessionId)); conversation.input.setStagedDraft(prompt) })
        .catch((error: unknown) => { console.error(error) })
      return
    }
    const current = sessions.list.getSnapshot().current
    const selected = current === undefined ? undefined
      : workspaces.list.getSnapshot().items.find(item => item.sessionIds.includes(current))?.workspaceId
    conversation.input.setStagedDraft(prompt, connectorSessionPreparation(workspaces, sessions, async (name) => {
      const path = await desktopInvoke('create_automatic_workspace', { name })
      if (typeof path !== 'string') throw new Error(text('无法创建默认工作区，请稍后重试。'))
      return path
    }, selected))
    sessions.clear()
  }
  registerFeaturePanel(ctx, 'skill-connectors', 20, { controller, title: text('连接器'),
    subtitle: text('管理已授权的政务协同与数据服务连接'), requiresDirectInternet: true,
    visibility: ctx.wanweiNetwork.visibility('connectors'), Icon: ConnectorsIcon,
    hooks: { network: ctx.wanweiNetwork },
    renderContent: () => <Connectors dingTalk={dingTalk} weChat={weChat} feishu={feishu}
      onTryPrompt={onTryPrompt} checkConnection={checkConnection} />,
  })
  ctx.slots.inject('conversation.composer.tools', () => ctx.slots.register(
    { name: 'conversation.composer.tools', id: 'wanwei-active-connector', order: 0 },
    function ActiveComposerConnector() {
      const [states, setStates] = useState<Record<string, boolean>>({})
      useEffect(() => {
        let disposed = false
        const refresh = async () => {
          try {
            const result = await connection.rpc.call('/wanwei-connectors', 'options', {})
            if (!result.ok || disposed || !Array.isArray(result.value)) return
            const next: Record<string, boolean> = {}
            for (const item of result.value as { id: string; connected: boolean }[]) next[item.id] = item.connected
            setStates(next)
          } catch { /* A later focus refresh retries local transport failures. */ }
        }
        void refresh()
        const onFocus = () => { void refresh() }
        window.addEventListener('focus', onFocus)
        return () => { disposed = true; window.removeEventListener('focus', onFocus) }
      }, [])
      useEffect(() => {
        removeActiveConnectorId('wecom')
        for (const item of CONNECTORS) {
          if (states[item.id]) setActiveConnectorId(item.id)
          else removeActiveConnectorId(item.id)
        }
      }, [states])
      return <ComposerConnectorChip onManage={() => { controller.open() }} options={CONNECTORS.map(item => ({
        ...item, available: states[item.id] === true,
      }))} />
    },
  ))
}
