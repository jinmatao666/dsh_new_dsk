import {
  createPanelController, registerFeaturePanel, ServiceUnavailable, Toast, type WanweiNotice,
} from '@deepseek-ai/dsh-wanwei-feature-panels/client'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import './page.css'
import { connectorSessionPreparation, desktopInvoke } from './try-session.ts'
import { useEffect, useState } from 'react'
import { PlusIcon } from '@deepseek-ai/dsh-wanwei-feature-panels/client'
import { Select } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  removeActiveConnectorId,
  setActiveConnectorId,
} from './active-connector.ts'
import { ComposerConnectorChip } from './ComposerConnectorChip.tsx'
import { createDingTalkApi } from './dingtalk-api.ts'
import { DingTalkPanel, DINGTALK_EXAMPLE_PROMPTS, type DingTalkApi, type DingTalkStatus } from './DingTalkPanel.tsx'
import { getCachedDingTalkStatus, setCachedDingTalkStatus } from './status-cache.ts'
import { createWeComApi } from './wecom-api.ts'
import { WeComPanel, WECOM_EXAMPLE_PROMPTS, type WeComApi, type WeComStatus } from './WeComPanel.tsx'
import { getCachedWeComStatus, setCachedWeComStatus } from './wecom-status-cache.ts'
import { createWeChatApi } from './wechat-api.ts'
import { WeChatPanel, WECHAT_EXAMPLE_PROMPTS, type WeChatApi, type WeChatStatus } from './WeChatPanel.tsx'
import { getCachedWeChatStatus, setCachedWeChatStatus } from './wechat-status-cache.ts'
import { productText } from './locales/product.ts'
/* oxlint-disable @stylistic/arrow-parens */
type ConnectorKind = 'demo' | 'dingtalk-channel' | 'wecom-channel' | 'wechat-channel'
type Connector = {
  id: string
  name: string
  summary: string
  scope: string
  accent: string
  icon: string
  capabilities: readonly string[]
  access: string
  /** Real product channel vs local demonstration catalog entry. */
  kind?: ConnectorKind
}

const CONNECTORS: readonly Connector[] = [
  { id: 'zj-dingtalk', name: '浙政钉', summary: productText('接入组织通讯录、待办与消息通知，将任务结果送达政务协同入口。'), scope: '政务协同', accent: '#1677ff', icon: '/connector-icons/zj-dingtalk.svg', capabilities: ['待办推送', '组织通讯录', '消息通知'], access: '需由单位管理员完成组织授权' },
  {
    id: 'dingtalk',
    name: '钉钉',
    summary: productText('连接钉钉消息、日程、审批与待办，在任务完成后推送结果通知。'),
    scope: '钉钉技能',
    accent: '#1677ff',
    icon: '/connector-icons/dingtalk.png',
    capabilities: ['AI 表格', '日历', '群聊与机器人', '文档与云盘', '邮箱', '待办'],
    access: productText('产品已随包 dws；点「连接」完成钉钉授权后，即可在桌面对话中调用钉钉能力。'),
    kind: 'dingtalk-channel',
  },
  { id: 'qq-mail', name: 'QQ 邮箱', summary: productText('在授权邮箱内检索邮件、形成摘要，并将结果保存为待发送草稿。'), scope: '邮箱协作', accent: '#f5a700', icon: '/connector-icons/qq-mail.png', capabilities: ['邮件检索', '摘要提炼', '草稿交付'], access: '按邮箱账号授权，可随时取消' },
  { id: 'office-mail', name: '办公邮箱', summary: productText('读取和起草授权范围内的办公邮件，支持将审阅结果作为邮件草稿交付。'), scope: '办公邮件', accent: '#0f766e', icon: '/connector-icons/office-mail.svg', capabilities: ['邮件读取', '草稿起草', '附件摘要'], access: 'OAuth 授权，不保存账号密码' },
  { id: 'internal-mail', name: '内部邮箱', summary: productText('适配内网 SMTP 或 Exchange 环境，专用于不出网的邮件通知与归档。'), scope: '内网邮件', accent: '#7c3aed', icon: '/connector-icons/internal-mail.svg', capabilities: ['内网投递', '通知归档', '审批抄送'], access: '需管理员配置内网服务地址' },
  { id: 'feishu', name: '飞书', summary: productText('协助整理飞书文档、群消息和待办信息，支持将成果回写到协作空间。'), scope: '团队协作', accent: '#00aeef', icon: '/connector-icons/feishu.png', capabilities: ['云文档', '群消息', '待办同步'], access: '仅访问你选择的工作空间内容' },
  {
    id: 'wecom',
    name: '企业微信',
    summary: productText('连接企业微信的消息、日程和审批通知，为内部协同提供统一入口。'),
    scope: '企业微信技能',
    accent: '#2d8cf0',
    icon: '/connector-icons/wecom.png',
    capabilities: ['消息', '邮件', '文档', '待办', '日程', '会议', '微盘', '通讯录'],
    access: productText('授权本机 wecom-cli 扫码接入，并启用 wecomcli 技能后，可在桌面对话中调用企业微信能力。'),
    kind: 'wecom-channel',
  },
  {
    id: 'wechat',
    name: '微信助理',
    summary: productText('通过微信直接下发指令，结果实时回传至微信聊天窗口。'),
    scope: '远程通道',
    accent: '#07c160',
    icon: '/connector-icons/wechat.svg',
    capabilities: ['远程指令', '结果回传', '扫码绑定'],
    access: productText('产品随包 iLink 扫码绑定；授权后可用微信聊天远程指挥本机。'),
    kind: 'wechat-channel',
  },
  { id: 'tencent-docs', name: '腾讯文档', summary: productText('读取和整理在线文档、表格与收集表，适合多人协作的材料汇编。'), scope: '在线文档', accent: '#00a6ff', icon: '/connector-icons/tencent-docs.png', capabilities: ['文档读取', '表格整理', '协作交付'], access: '通过个人授权访问指定文档' },
  { id: 'tencent-meeting', name: '腾讯会议', summary: productText('汇总会议日程与会议纪要，帮助将任务提醒推送给参会相关人员。'), scope: '会议协同', accent: '#2f7cf6', icon: '/connector-icons/tencent-meeting.png', capabilities: ['会议日程', '纪要整理', '提醒推送'], access: '需要会议组织者或个人账号授权' },
  { id: 'aliyun-drive', name: '阿里云盘', summary: productText('在授权范围内读取与归档项目资料，支持大文件交付与版本管理。'), scope: '云存储', accent: '#ff6a00', icon: '/connector-icons/aliyun-drive.png', capabilities: ['文件读取', '大文件交付', '版本归档'], access: '仅访问授权文件夹内容' },
  { id: 'baidu-map', name: '百度地图', summary: productText('调用地图服务能力进行地址解析、POI 检索与空间定位辅助。'), scope: '地图服务', accent: '#4b85ef', icon: '/connector-icons/baidu-map.png', capabilities: ['地址解析', 'POI 检索', '坐标定位'], access: '按 Key 授权，不记录查询轨迹' },
  { id: 'amap', name: '高德地图', summary: productText('提供地理编码、路径规划和行政区划查询，辅助空间分析与选址论证。'), scope: '地图服务', accent: '#2f8cee', icon: '/connector-icons/amap.png', capabilities: ['地理编码', '路径规划', '区划查询'], access: '按 Key 授权，不记录查询轨迹' },
  { id: 'doc-center', name: '政务文档中心', summary: productText('连接受控文档库，在授予的目录范围内检索、读取和提交交付物。'), scope: '政务资料', accent: '#b45309', icon: '/connector-icons/doc-center.svg', capabilities: ['目录检索', '受控下载', '成果提交'], access: '按目录及文档权限控制访问' },
  { id: 'spatial-db', name: '空间数据库', summary: productText('连接 PostGIS / SDE 等空间数据库，读取要素类与属性表用于分析。'), scope: '空间数据', accent: '#06b6d4', icon: '/connector-icons/spatial-db.svg', capabilities: ['要素读取', '空间查询', '属性关联'], access: '只读连接，不保存数据库凭据' },
  { id: 'pm-system', name: '项目管理系统', summary: productText('读取项目进度、任务分工与里程碑信息，生成项目跟踪与汇报材料。'), scope: '项目管理', accent: '#8b5cf6', icon: '/connector-icons/pm-system.svg', capabilities: ['进度读取', '任务汇总', '里程碑跟踪'], access: '按项目授权访问可见范围' },
  { id: 'archive-system', name: '档案管理系统', summary: productText('按授权范围检索历史项目档案，支持资料调阅与成果归档。'), scope: '档案管理', accent: '#6366f1', icon: '/connector-icons/archive-system.svg', capabilities: ['档案检索', '资料调阅', '成果归档'], access: '按档案密级与目录权限控制' },
]

function ConnectorBrandIcon({ icon, accent }: { icon: string; accent: string }) {
  // Bundled official brand artwork renders on a white tile; emoji values
  // keep the accent placeholder. 浙政钉 stays neutral until official artwork is licensed.
  if (icon.startsWith('/connector-icons/')) {
    return (
      <span aria-hidden="true" className="dsh-connector-brand">
        <img src={icon} alt="" width={24} height={24} />
      </span>
    )
  }
  return (
    <span aria-hidden="true" className="dsh-connector-brand is-emoji" style={{ background: accent }}>
      {icon}
    </span>
  )
}

/** WorkBuddy-style「去试试」glyph on a connected connector row. */
function ConnectorTryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <path
        d="M3.2 3.4h7.2a1.6 1.6 0 0 1 1.6 1.6v4a1.6 1.6 0 0 1-1.6 1.6H7.1L4.4 13.2V10.6H3.2A1.6 1.6 0 0 1 1.6 9V5a1.6 1.6 0 0 1 1.6-1.6Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M7.1 5.8v3.2L9.8 7.4 7.1 5.8Z" fill="currentColor" />
    </svg>
  )
}

/** Opens the custom-connector dialog from the fixed feature-panel header. */
let openCustomConnector: (() => void) | null = null

function channelTitle(connector: Connector): string {
  if (connector.kind === 'dingtalk-channel') return productText('连接 钉钉')
  if (connector.kind === 'wecom-channel') return productText('连接 企业微信')
  if (connector.kind === 'wechat-channel') return productText('连接 微信助理')
  return productText('{0}连接器详情', [connector.name])
}

function channelSubtitle(connector: Connector): string {
  if (connector.kind === 'dingtalk-channel') return productText(' · 钉钉技能')
  if (connector.kind === 'wecom-channel') return productText(' · 企业微信技能')
  if (connector.kind === 'wechat-channel') return productText(' · 远程通道')
  return `${connector.scope}${productText(' · 本地演示目录')}`
}

function isLiveChannel(kind: ConnectorKind | undefined): boolean {
  return kind === 'dingtalk-channel' || kind === 'wecom-channel' || kind === 'wechat-channel'
}

/** Render the connector directory after the configured platform responds.
 * @param props - Live channel APIs, try-prompt handoff, and platform connectivity check.
 * @returns Directory, loading state or service placeholder.
 */
export function Connectors({
  dingTalk,
  weCom,
  weChat,
  onTryPrompt,
  checkConnection,
}: {
  dingTalk: DingTalkApi
  weCom: WeComApi
  weChat: WeChatApi
  onTryPrompt: (prompt: string, connectorId: string) => void
  checkConnection: () => Promise<unknown>
}) {
  const [connection, setConnection] = useState<'loading' | 'ready' | 'failed'>('loading')
  useEffect(() => {
    let disposed = false
    setConnection('loading')
    void checkConnection().then(() => { if (!disposed) setConnection('ready') }).catch(() => {
      if (!disposed) setConnection('failed')
    })
    return () => { disposed = true }
  }, [checkConnection])
  const [requested, setRequested] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<Connector | null>(null)
  const [showCustom, setShowCustom] = useState(false)
  const [customConnectors, setCustomConnectors] = useState<Connector[]>([])
  const [customName, setCustomName] = useState('')
  const [customCategory, setCustomCategory] = useState('协同办公')
  const [customDescription, setCustomDescription] = useState('')
  const [dingTalkStatus, setDingTalkStatus] = useState<DingTalkStatus | null>(() => getCachedDingTalkStatus())
  const [weComStatus, setWeComStatus] = useState<WeComStatus | null>(() => getCachedWeComStatus())
  const [weChatStatus, setWeChatStatus] = useState<WeChatStatus | null>(() => getCachedWeChatStatus())
  const [notice, setNotice] = useState<WanweiNotice | null>(null)
  const connectors = [...CONNECTORS, ...customConnectors]
  const rememberDingTalk = (value: DingTalkStatus) => {
    setCachedDingTalkStatus(value)
    setDingTalkStatus(value)
  }
  const rememberWeCom = (value: WeComStatus) => {
    setCachedWeComStatus(value)
    setWeComStatus(value)
  }
  const rememberWeChat = (value: WeChatStatus) => {
    setCachedWeChatStatus(value)
    setWeChatStatus(value)
  }
  useEffect(() => {
    openCustomConnector = () => { setShowCustom(true) }
    return () => { openCustomConnector = null }
  }, [])
  useEffect(() => {
    void dingTalk.status().then(rememberDingTalk).catch(() => {})
  }, [dingTalk])
  useEffect(() => {
    void weCom.status().then(rememberWeCom).catch(() => {})
  }, [weCom])
  useEffect(() => {
    void weChat.status().then(rememberWeChat).catch(() => {})
  }, [weChat])
  const dingTalkConnected = dingTalkStatus?.authed === true && dingTalkStatus.skillInstalled === true
  const weComConnected = weComStatus?.authed === true && weComStatus.skillInstalled === true
  const weChatConnected = weChatStatus?.authed === true
  const requestAccess = (connector: Connector) =>{  setRequested(current => new Set(current).add(connector.id)) }
  const saveCustomConnector = () => {
    const name = customName.trim()
    if (name === '') return
    const connector = { id: `custom-${Date.now()}`, name, summary: customDescription.trim() || productText('这是一个保存在本机演示列表中的自定义连接器。'), scope: customCategory, accent: '#4969d8', icon: '/connector-icons/plug.svg', capabilities: ['连接说明', '访问范围', '使用提醒'], access: '演示阶段不会发起网络连接或保存凭据' }
    setCustomConnectors(items => [connector, ...items])
    setCustomName('')
    setCustomDescription('')
    setShowCustom(false)
    setSelected(connector)
  }
  const dingTalkApi: DingTalkApi = {
    status: async () => {
      const value = await dingTalk.status()
      rememberDingTalk(value)
      return value
    },
    login: async () => {
      const value = await dingTalk.login()
      rememberDingTalk(value)
      return value
    },
    installSkill: async () => {
      const value = await dingTalk.installSkill()
      rememberDingTalk(value)
      return value
    },
    disconnect: async () => {
      const value = await dingTalk.disconnect()
      rememberDingTalk(value)
      if (!(value.authed && value.skillInstalled)) removeActiveConnectorId('dingtalk')
      return value
    },
  }

  const weComApi: WeComApi = {
    status: async () => {
      const value = await weCom.status()
      rememberWeCom(value)
      return value
    },
    login: async () => {
      const value = await weCom.login()
      rememberWeCom(value)
      return value
    },
    installSkill: async () => {
      const value = await weCom.installSkill()
      rememberWeCom(value)
      return value
    },
    disconnect: async () => {
      const value = await weCom.disconnect()
      rememberWeCom(value)
      if (!(value.authed && value.skillInstalled)) removeActiveConnectorId('wecom')
      return value
    },
  }

  const weChatApi: WeChatApi = {
    status: async () => {
      const value = await weChat.status()
      rememberWeChat(value)
      return value
    },
    loginStart: async () => {
      const value = await weChat.loginStart()
      rememberWeChat(value.status)
      return value
    },
    loginPoll: async (sessionKey, verifyCode) => {
      const value = await weChat.loginPoll(sessionKey, verifyCode)
      rememberWeChat(value.status)
      return value
    },
    disconnect: async () => {
      const value = await weChat.disconnect()
      rememberWeChat(value)
      if (!value.authed) removeActiveConnectorId('wechat')
      return value
    },
  }

  if (connection === 'loading') return <p role="status">{productText('正在连接服务…')}</p>
  if (connection === 'failed') return <ServiceUnavailable variant="connectors" title={productText('暂时无法连接连接器服务')}
    description={productText('当前网络无法连接该服务，请检查网络连接或联系管理员。')} />
  return <section className="dsh-connectors-page">
    <Toast notice={notice} setNotice={setNotice} />
    <div className="dsh-connectors-grid" role="list">
      {connectors.map(connector => {
        const connected = (connector.kind === 'dingtalk-channel' && dingTalkConnected)
          || (connector.kind === 'wecom-channel' && weComConnected)
          || (connector.kind === 'wechat-channel' && weChatConnected)
        const tryPrompt = connector.kind === 'wecom-channel'
          ? WECOM_EXAMPLE_PROMPTS[1]
          : connector.kind === 'wechat-channel'
            ? WECHAT_EXAMPLE_PROMPTS[0]
            : DINGTALK_EXAMPLE_PROMPTS[1]
        return (
          <div
            key={connector.id}
            role="listitem"
            className={connected ? 'dsh-connector-card is-connected' : 'dsh-connector-card'}
          >
            <button
              type="button"
              className="dsh-connector-card-main"
              onClick={() => { setSelected(connector) }}
              aria-label={channelTitle(connector)}
            >
              <ConnectorBrandIcon icon={connector.icon} accent={connector.accent} />
              <span className="dsh-connector-card-copy">
                <span className="dsh-connector-card-title">
                  <strong>{connector.name}</strong>
                </span>
                <span className="dsh-connector-card-summary">{connector.summary}</span>
              </span>
            </button>
            <div className="dsh-connector-card-trail">
              {connected ? (
                <>
                  <span className="dsh-connector-status-dot" title={productText('已连接')} aria-label={productText('已连接')} />
                  <button
                    type="button"
                    className="dsh-connector-try"
                    aria-label={productText('去试试')}
                    title={productText('去试试')}
                    onClick={() => { onTryPrompt(tryPrompt, connector.id) }}
                  >
                    <ConnectorTryIcon />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="dsh-connector-add"
                  aria-label={isLiveChannel(connector.kind) ? productText('连接') : productText('申请接入')}
                  title={isLiveChannel(connector.kind) ? productText('连接') : productText('申请接入')}
                  onClick={() => { setSelected(connector) }}
                >
                  <PlusIcon />
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
    {selected !== null && <div className="dsh-connector-modal-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) setSelected(null) }}><section className="dsh-connector-detail" aria-label={channelTitle(selected)}><header><div><ConnectorBrandIcon icon={selected.icon} accent={selected.accent} /><div><h2>{selected.kind === 'dingtalk-channel' || selected.kind === 'wecom-channel' || selected.kind === 'wechat-channel' ? channelTitle(selected) : selected.name}</h2><p>{channelSubtitle(selected)}</p></div></div><button type="button" onClick={() =>{  setSelected(null) }} aria-label={productText('关闭')}>×</button></header>{selected.kind === 'dingtalk-channel' ? <DingTalkPanel api={dingTalkApi} initialStatus={dingTalkStatus} onNotice={setNotice} onTry={(prompt) => {
      setSelected(null)
      onTryPrompt(prompt, 'dingtalk')
    }} /> : selected.kind === 'wecom-channel' ? <WeComPanel api={weComApi} initialStatus={weComStatus} onNotice={setNotice} onTry={(prompt) => {
      setSelected(null)
      onTryPrompt(prompt, 'wecom')
    }} /> : selected.kind === 'wechat-channel' ? <WeChatPanel api={weChatApi} initialStatus={weChatStatus} onNotice={setNotice} onTry={(prompt) => {
      setSelected(null)
      onTryPrompt(prompt, 'wechat')
    }} /> : <><p className="dsh-connector-detail-summary">{selected.summary}</p><div className="dsh-connector-detail-block"><span>{productText('可协助完成')}</span><div>{selected.capabilities.map(item => <b key={item}>{item}</b>)}</div></div><div className="dsh-connector-detail-block"><span>{productText('接入说明')}</span><p>{selected.access}</p></div><footer><small>{productText('接入后仅在授权范围内访问数据。')}</small><button type="button" className={requested.has(selected.id) ? 'requested' : ''} onClick={() =>{  requestAccess(selected) }}>{requested.has(selected.id) ? productText('已提交申请') : productText('申请接入')}</button></footer></>}</section></div>}
    {showCustom && <div className="dsh-connector-modal-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) setShowCustom(false) }}><form className="dsh-connector-custom" onSubmit={event => { event.preventDefault(); saveCustomConnector() }}><header><div><h2>{productText('自定义连接器')}</h2><p>{productText('添加团队内部服务说明，当前仅保存在本机演示列表。')}</p></div><button type="button" onClick={() =>{  setShowCustom(false) }} aria-label={productText('关闭')}>×</button></header><label>{productText('连接器名称')}<input autoFocus value={customName} onChange={event =>{  setCustomName(event.target.value) }} placeholder={productText('例如：项目资料共享库')} /></label><label>{productText('服务类型')}<Select label={productText('服务类型')} value={customCategory} onChange={setCustomCategory} options={[{ value: productText('协同办公'), label: productText('协同办公') }, { value: productText('文档服务'), label: productText('文档服务') }, { value: productText('邮箱服务'), label: productText('邮箱服务') }, { value: productText('内部数据'), label: productText('内部数据') }]} /></label><label>{productText('用途说明')}<textarea value={customDescription} onChange={event =>{  setCustomDescription(event.target.value) }} placeholder={productText('说明它能帮助处理哪些资料或协作事项')} /></label><div className="dsh-connector-custom-tip">{productText('暂不要求填写地址、密钥或账户信息；正式接入时将由管理员统一配置。')}</div><footer><button type="button" onClick={() =>{  setShowCustom(false) }}>{productText('取消')}</button><button type="submit" disabled={customName.trim() === ''}>{productText('添加到演示列表')}</button></footer></form></div>}
  </section>
}
function ConnectorsIcon({ size = 18 }: { size?: number }) {
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


  return <svg {...shared}><path d="M8 7V4M12 7V4M6 7h8v4a4 4 0 0 1-8 0V7Z" /><path d="M10 15v2a3 3 0 0 0 3 3h3" /><path d="m16 17 3 3-3 3" /></svg>
}

export const inject = ['slots', 'connection', 'conversation', 'sessions', 'workspaces', 'wanweiNetwork']
/** Mount the connector directory; DingTalk/WeCom use CLI skills; WeChat is an inbound remote channel.
 * @param ctx - Product Client context.
 */
export function apply(ctx: Context): void {
  const controller = createPanelController(ctx, 'wanwei-connectors')
  const checkConnection = () => ctx.wanweiNetwork.refresh()
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const conversation = ctx.get('conversation') as IConversation
  const sessions = ctx.get('sessions') as ISessions
  const workspaces: IWorkspaces = ctx.workspaces
  const dingTalk = createDingTalkApi(connection)
  const weCom = createWeComApi(connection)
  const weChat = createWeChatApi(connection)
  const onTryPrompt = (prompt: string, connectorId: string) => {
    // Leave the connectors overlay, attach the connector chip, and stage the example (WorkBuddy「去试试」).
    // Auto-prepare a Workspace Session on first send so WeChat (and other channels) need no picker.
    const current = sessions.list.getSnapshot().current
    const selected = current === undefined
      ? undefined
      : workspaces.list.getSnapshot().items.find(item => item.sessionIds.includes(current))?.workspaceId
    setActiveConnectorId(connectorId)
    controller.close()
    conversation.input.setStagedDraft(
      prompt,
      connectorSessionPreparation(workspaces, sessions, async (name) => {
        const path = await desktopInvoke('create_automatic_workspace', { name })
        if (typeof path !== 'string') throw new Error(productText('无法创建默认工作区，请稍后重试。'))
        return path
      }, selected),
    )
    sessions.clear()
  }
  registerFeaturePanel(ctx, 'skill-connectors', 20, { controller, title: productText('连接器'),
    subtitle: productText('管理已授权的政务协同与数据服务连接'), blockedIntranet: true, visibility: ctx.wanweiNetwork.visibility('connectors'), Icon: ConnectorsIcon,
    hooks: { network: ctx.wanweiNetwork },
    renderHeaderActions: () => (
      <button
        type="button"
        className="dsh-connectors-header-action"
        onClick={() => { openCustomConnector?.() }}
      >
        <PlusIcon /> {productText(' 自定义连接器')}
      </button>
    ),
    renderContent: () => (
      <Connectors
        dingTalk={dingTalk}
        weCom={weCom}
        weChat={weChat}
        onTryPrompt={onTryPrompt}
        checkConnection={checkConnection}
      />
    ),
  })
  // Hero / staged-draft mode has no Session, so the chip cannot live on conversation.input.left.
  ctx.slots.inject('conversation.composer.tools', () =>
    ctx.slots.register(
      { name: 'conversation.composer.tools', id: 'wanwei-active-connector', order: 0 },
      function ActiveComposerConnector() {
        const dingTalkCached = getCachedDingTalkStatus()
        const weComCached = getCachedWeComStatus()
        const weChatCached = getCachedWeChatStatus()
        const [dingTalkConnected, setDingTalkConnected] = useState(
          () => dingTalkCached?.authed === true && dingTalkCached.skillInstalled === true,
        )
        const [weComConnected, setWeComConnected] = useState(
          () => weComCached?.authed === true && weComCached.skillInstalled === true,
        )
        const [weChatConnected, setWeChatConnected] = useState(
          () => weChatCached?.authed === true,
        )
        useEffect(() => {
          void dingTalk.status()
            .then(value => {
              setCachedDingTalkStatus(value)
              setDingTalkConnected(value.authed && value.skillInstalled)
            })
            .catch(() => { setDingTalkConnected(false) })
          void weCom.status()
            .then(value => {
              setCachedWeComStatus(value)
              setWeComConnected(value.authed && value.skillInstalled)
            })
            .catch(() => { setWeComConnected(false) })
          void weChat.status()
            .then(value => {
              setCachedWeChatStatus(value)
              setWeChatConnected(value.authed)
            })
            .catch(() => { setWeChatConnected(false) })
        }, [])
        // Connected accounts attach to the composer stack (WorkBuddy: all authed icons).
        useEffect(() => {
          if (dingTalkConnected) setActiveConnectorId('dingtalk')
          else removeActiveConnectorId('dingtalk')
        }, [dingTalkConnected])
        useEffect(() => {
          if (weComConnected) setActiveConnectorId('wecom')
          else removeActiveConnectorId('wecom')
        }, [weComConnected])
        useEffect(() => {
          if (weChatConnected) setActiveConnectorId('wechat')
          else removeActiveConnectorId('wechat')
        }, [weChatConnected])
        return (
          <ComposerConnectorChip
            onManage={() => { controller.open() }}
            options={CONNECTORS.map(entry => ({
              id: entry.id,
              name: entry.name,
              icon: entry.icon,
              accent: entry.accent,
              available: (entry.kind === 'dingtalk-channel' && dingTalkConnected)
                || (entry.kind === 'wecom-channel' && weComConnected)
                || (entry.kind === 'wechat-channel' && weChatConnected),
            }))}
          />
        )
      },
    ))
}
