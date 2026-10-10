import { createPanelController, registerFeaturePanel } from '@deepseek-ai/dsh-wanwei-feature-panels/client'
import type { Context } from '@deepseek-ai/cordis'
import './page.css'
import { useState } from 'react'
import { PlusIcon } from '@deepseek-ai/dsh-wanwei-feature-panels/client'
import { Select } from '@deepseek-ai/dsh-client-ui-primitives'
import { productText } from './locales/product.ts'
/* oxlint-disable @stylistic/arrow-parens */
type Connector = {
  id: string
  name: string
  summary: string
  scope: string
  accent: string
  icon: string
  capabilities: readonly string[]
  access: string
}

const CONNECTORS: readonly Connector[] = [
  { id: 'zj-dingtalk', name: '浙政钉', summary: productText('接入组织通讯录、待办与消息通知，将任务结果送达政务协同入口。'), scope: '政务协同', accent: '#1677ff', icon: '/connector-icons/zj-dingtalk.svg', capabilities: ['待办推送', '组织通讯录', '消息通知'], access: '需由单位管理员完成组织授权' },
  { id: 'dingtalk', name: '钉钉', summary: productText('连接钉钉消息、日程、审批与待办，在任务完成后推送结果通知。'), scope: '政务协同', accent: '#1677ff', icon: '/connector-icons/dingtalk.png', capabilities: ['消息推送', '审批同步', '日程提醒'], access: '按组织维度授权，支持随时取消' },
  { id: 'qq-mail', name: 'QQ 邮箱', summary: productText('在授权邮箱内检索邮件、形成摘要，并将结果保存为待发送草稿。'), scope: '邮箱协作', accent: '#f5a700', icon: '/connector-icons/qq-mail.png', capabilities: ['邮件检索', '摘要提炼', '草稿交付'], access: '按邮箱账号授权，可随时取消' },
  { id: 'office-mail', name: '办公邮箱', summary: productText('读取和起草授权范围内的办公邮件，支持将审阅结果作为邮件草稿交付。'), scope: '办公邮件', accent: '#0f766e', icon: '/connector-icons/office-mail.svg', capabilities: ['邮件读取', '草稿起草', '附件摘要'], access: 'OAuth 授权，不保存账号密码' },
  { id: 'internal-mail', name: '内部邮箱', summary: productText('适配内网 SMTP 或 Exchange 环境，专用于不出网的邮件通知与归档。'), scope: '内网邮件', accent: '#7c3aed', icon: '/connector-icons/internal-mail.svg', capabilities: ['内网投递', '通知归档', '审批抄送'], access: '需管理员配置内网服务地址' },
  { id: 'feishu', name: '飞书', summary: productText('协助整理飞书文档、群消息和待办信息，支持将成果回写到协作空间。'), scope: '团队协作', accent: '#00aeef', icon: '/connector-icons/feishu.png', capabilities: ['云文档', '群消息', '待办同步'], access: '仅访问你选择的工作空间内容' },
  { id: 'wecom', name: '企业微信', summary: productText('连接企业微信的消息、日程和审批通知，为内部协同提供统一入口。'), scope: '内部协同', accent: '#2d8cf0', icon: '/connector-icons/wecom.png', capabilities: ['消息提醒', '审批通知', '日程同步'], access: '由企业管理员配置可用范围' },
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
  // keep the accent placeholder.  浙政钉 is a registered government mark and
  // intentionally stays on a neutral placeholder until official artwork is
  // licensed for redistribution.
  if (icon.startsWith('/connector-icons/')) {
    return (
      <span
        aria-hidden="true"
        style={{
          display: 'grid',
          placeItems: 'center',
          width: 38,
          height: 38,
          borderRadius: 10,
          background: '#fff',
          boxShadow: 'inset 0 0 0 1px rgba(38, 49, 72, 0.1)',
        }}
      >
        <img src={icon} alt="" width={24} height={24} style={{ display: 'block', objectFit: 'contain' }} />
      </span>
    )
  }
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'grid',
        placeItems: 'center',
        width: 38,
        height: 38,
        borderRadius: 10,
        background: accent,
        color: '#fff',
        fontSize: 20,
        lineHeight: 1,
      }}
    >
      {icon}
    </span>
  )
}

function Connectors() {
  const [requested, setRequested] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<Connector | null>(null)
  const [showCustom, setShowCustom] = useState(false)
  const [customConnectors, setCustomConnectors] = useState<Connector[]>([])
  const [customName, setCustomName] = useState('')
  const [customCategory, setCustomCategory] = useState('协同办公')
  const [customDescription, setCustomDescription] = useState('')
  const connectors = [...CONNECTORS, ...customConnectors]
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
  return <section className="dsh-connectors-page">
    <div className="dsh-connectors-toolbar"><button type="button" onClick={() =>{  setShowCustom(true) }}><PlusIcon /> {productText(' 自定义连接器')}</button></div>
    <div className="dsh-connectors-grid">
      {connectors.map(connector => <button type="button" className="dsh-connector-card" key={connector.id} onClick={() =>{  setSelected(connector) }}>
        <div className="dsh-connector-card-top"><ConnectorBrandIcon icon={connector.icon} accent={connector.accent} /><span>{connector.scope}</span></div>
        <strong>{connector.name}</strong><p>{connector.summary}</p>
        <small>{requested.has(connector.id) ? productText('已保存申请') : productText('点击查看接入详情')}</small><i aria-hidden="true">›</i>
      </button>)}
    </div>
    {selected !== null && <div className="dsh-connector-modal-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) setSelected(null) }}><section className="dsh-connector-detail" aria-label={productText('{0}连接器详情', [selected.name])}><header><div><ConnectorBrandIcon icon={selected.icon} accent={selected.accent} /><div><h2>{selected.name}</h2><p>{selected.scope} {productText(' · 本地演示目录')}</p></div></div><button type="button" onClick={() =>{  setSelected(null) }} aria-label={productText('关闭')}>×</button></header><p className="dsh-connector-detail-summary">{selected.summary}</p><div className="dsh-connector-detail-block"><span>{productText('可协助完成')}</span><div>{selected.capabilities.map(item => <b key={item}>{item}</b>)}</div></div><div className="dsh-connector-detail-block"><span>{productText('接入说明')}</span><p>{selected.access}</p></div><footer><small>{productText('接入后仅在授权范围内访问数据。')}</small><button type="button" className={requested.has(selected.id) ? 'requested' : ''} onClick={() =>{  requestAccess(selected) }}>{requested.has(selected.id) ? productText('已提交申请') : productText('申请接入')}</button></footer></section></div>}
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

export const inject = ['slots', 'wanweiNetwork']
/** Mount only the connector directory and its demo configuration.
 * @param ctx - Product Client context.
 */
export function apply(ctx: Context): void {
  const controller = createPanelController(ctx, 'wanwei-connectors')
  registerFeaturePanel(ctx, 'skill-connectors', 20, { controller, title: productText('连接器'),
    subtitle: productText('管理已授权的政务协同与数据服务连接'), blockedIntranet: true, visibility: ctx.wanweiNetwork.visibility('connectors'), Icon: ConnectorsIcon,
    hooks: { network: ctx.wanweiNetwork }, renderContent: () => <Connectors />,
  })
}
