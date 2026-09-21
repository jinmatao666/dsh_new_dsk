import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ClientContext, IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle, RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  browseMarketplaceCatalog,
  buildMarketplaceCatalog,
  buildMarketplaceCategories,
  countPersonalSkillReviews,
  filterPersonalSkillUploads,
  formatNavigationCount,
  publishedSkillCategories,
} from './catalog.ts'
import type { PersonalSkillReviewFilter, PersonalSkillUploadView } from './catalog.ts'
import { marketplaceInstallAction } from './install-action.ts'
import type { MarketplaceInstallState } from './install-action.ts'
import './marketplace.css'

type SkillParam = { name: string; type: string; required: boolean; description: string; defaultValue?: string }
type Skill = {
  id: string
  name: string
  category: string
  categories?: readonly string[]
  tags: readonly string[]
  summary: string
  description: string
  installs: string
  accent: string
  icon: string
  version: string
  author: string
  featured?: boolean
  params?: readonly SkillParam[]
  slug?: string
  installable?: boolean
  marketplacePublished?: boolean
  remoteId?: number
  source?: 'official' | 'personal'
  reviewStatus?: 'none' | 'pending' | 'approved' | 'rejected'
  reviewReason?: string
  visibility?: 'private' | 'public'
  submittedAt?: string | number
  reviewedAt?: string | number
  publishedSkillId?: number
  publishedVersion?: string
}

type MarketplaceSkillState = {
  id: string
  slug: string
  version: string
  installedVersion?: string | null
  state: MarketplaceInstallState
}

type MarketplaceSection = 'skills' | 'experts' | 'connectors' | 'automations'

type ExpertTeam = {
  id: string
  name: string
  summary: string
  members: readonly string[]
  skills: readonly string[]
  accent: string
}

type Expert = {
  id: string
  name: string
  role: string
  category: string
  summary: string
  tags: readonly string[]
  examples: readonly string[]
  accent: string
  icon: 'planning' | 'policy' | 'gis' | 'survey' | 'ecology' | 'property' | 'writing'
}

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


type Automation = {
  id: string
  name: string
  summary: string
  trigger: string
  steps: readonly string[]
  accent: string
}

type AutomationTemplate = Automation & { cadence: string; prompt: string; scope: string }
type AutomationDraft = { id: string; name: string; cadence: string; time: string; prompt: string; source: '模板' | '手动' }

type DesktopBridge = { core?: { invoke?: (command: string, argumentsValue?: unknown) => Promise<unknown> } }
type DesktopInternals = { invoke?: (command: string, argumentsValue?: unknown) => Promise<unknown> }
type RemoteSkill = {
  id?: unknown
  name?: unknown
  display_name?: unknown
  icon?: unknown
  category?: unknown
  description?: unknown
  scenario?: unknown
  downloads?: unknown
  version?: unknown
  submitter?: unknown
  tags?: unknown
  source?: unknown
  categories?: unknown
}
type RemoteSkillCategory = { name?: unknown; code?: unknown }
type RemoteSkillBundle = { assets?: unknown; sha256?: unknown }
type RemotePersonalSkill = {
  id?: unknown
  name?: unknown
  display_name?: unknown
  category?: unknown
  icon?: unknown
  version?: unknown
  description?: unknown
  owner?: unknown
  visibility?: unknown
  review_status?: unknown
  review_reason?: unknown
  submitted_at?: unknown
  reviewed_at?: unknown
  created_at?: unknown
  updated_at?: unknown
  published_skill_id?: unknown
  published_version?: unknown
}

function parseReviewStatus(value: unknown): NonNullable<Skill['reviewStatus']> | undefined {
  if (value === 'none' || value === 'pending' || value === 'approved' || value === 'rejected') return value
  return undefined
}

function parseReviewTime(...values: unknown[]): string | number | undefined {
  return values.find(value => (typeof value === 'string' && value.trim() !== '')
    || (typeof value === 'number' && Number.isFinite(value) && value > 0)) as string | number | undefined
}

function formatReviewTime(value: string | number | undefined): string {
  if (value === undefined || value === '') return '—'
  const time = new Date(typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value)
  if (Number.isNaN(time.getTime())) return String(value)
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(time)
}

function reviewStatusLabel(status: Skill['reviewStatus']): string {
  if (status === 'pending') return '审核中'
  if (status === 'rejected') return '未通过'
  if (status === 'approved') return '已通过'
  return '未提交'
}

let loadRemoteSkills: (() => Promise<RemoteSkill[]>) | undefined
let loadRemoteCategories: (() => Promise<RemoteSkillCategory[]>) | undefined
let loadRemoteSkillBundle: ((id: number) => Promise<unknown>) | undefined
let recordRemoteSkillInstall: ((id: number) => Promise<unknown>) | undefined
let submitPersonalSkill: ((payload: unknown) => Promise<unknown>) | undefined
let loadPersonalSkills: (() => Promise<RemotePersonalSkill[]>) | undefined

function rpcValue(result: RpcResult<unknown>): unknown {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
type CustomSkillState = {
  slug: string
  name: string
  description: string
  body?: string
  files?: Array<{ path: string; contentBase64: string }>
}

function skillSlug(skill: Skill): string {
  if (skill.slug !== undefined) return skill.slug
  const value = skill.id.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `market-${value || 'custom-skill'}`
}

function desktopInvoke(command: string, argumentsValue: unknown): Promise<unknown> {
  const desktopWindow = window as Window & { __TAURI__?: DesktopBridge; __TAURI_INTERNALS__?: DesktopInternals }
  const invoke = desktopWindow.__TAURI__?.core?.invoke ?? desktopWindow.__TAURI_INTERNALS__?.invoke
  if (typeof invoke !== 'function') {
    return Promise.reject(new Error('未连接到桌面端原生安装服务。请重新打开 ZJUGIS Harness 后重试。'))
  }
  return invoke(command, argumentsValue)
}

function marketplaceInstallErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim() !== '') return error
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return '技能安装失败'
}

function hasVerifiedInstallCount(skill: Skill): boolean {
  return skill.remoteId !== undefined
}

function serverSkillFiles(bundle: unknown): { files: Array<{ path: string; content: number[] }>; sha256?: string } {
  const assets = (typeof bundle === 'object' && bundle !== null ? (bundle as { assets?: unknown }).assets : undefined)
  if (typeof assets !== 'string') throw new Error('服务器返回的技能包缺少文件内容')
  let parsed: unknown
  try {
    parsed = JSON.parse(assets)
  } catch {
    throw new Error('服务器返回的技能包格式无效')
  }
  const files = typeof parsed === 'object' && parsed !== null ? (parsed as { files?: unknown }).files : undefined
  if (!Array.isArray(files) || files.length === 0) throw new Error('服务器返回的技能包不包含文件')
  const candidateSha256 = (bundle as RemoteSkillBundle).sha256
  const sha256 = typeof candidateSha256 === 'string' ? candidateSha256 : undefined
  const decodedFiles = files.map((file) => {
    const path = typeof file === 'object' && file !== null ? (file as { path?: unknown }).path : undefined
    const contentBase64 = typeof file === 'object' && file !== null ? (file as { contentBase64?: unknown }).contentBase64 : undefined
    if (typeof path !== 'string' || typeof contentBase64 !== 'string') throw new Error('服务器返回的技能文件格式无效')
    const binary = atob(contentBase64)
    return { path, content: Array.from(binary, char => char.charCodeAt(0)) }
  })
  return sha256 === undefined ? { files: decodedFiles } : { files: decodedFiles, sha256 }
}

const L = {
  title: '技能市场',
  close: '关闭技能市场',
  subtitle: '发现可复用的工作流和智能助手',
  search: '搜索技能',
  myInstalled: '我的安装',
  myUploads: '我的上传',
  addSkill: '添加技能',
  all: '全部',
  featured: '推荐技能',
  allSkills: '全部技能',
  refresh: '换一批',
  installed: '已安装',
  install: '安装',
  count: '次安装',
  empty: '没有匹配的技能',
  action: '技能市场',
  back: '返回',
  detailInstall: '安装技能',
  version: '版本',
  author: '作者',
  params: '参数配置',
  noParams: '该技能无需配置参数',
  preview: '预览',
  uninstall: '卸载',
  createSkill: '导入个人技能',
  skills: '技能',
  experts: '专家库',
  connectors: '连接器',
  automations: '自动化',
}

const SECTION_COPY: Record<MarketplaceSection, { title: string; subtitle: string }> = {
  skills: { title: L.title, subtitle: L.subtitle },
  experts: { title: L.experts, subtitle: '为自然资源与政企协同场景匹配专业智能角色' },
  connectors: { title: L.connectors, subtitle: '管理已授权的政务协同与数据服务连接' },
  automations: { title: L.automations, subtitle: '配置定时执行、事件触发和自动交付流程' },
}

const EXPERT_TEAMS: readonly ExpertTeam[] = [
  { id: 'planning-review', name: '国土空间规划审查专家团', summary: '由政策解读、GIS 制图、文本审查与报告交付技能协同完成规划材料审查。', members: ['规划主理人', '政策分析师', 'GIS 工程师', '报告审核员'], skills: ['政策文件解析', 'GIS 制图导出', '咨询报告生成器'], accent: '#2563eb' },
  { id: 'land-approval', name: '建设项目用地报批专家团', summary: '围绕选址、用地合规、报批材料与风险核验组织分工，帮助完善项目用地报批材料。', members: ['用地顾问', '政策专员', '材料审核员'], skills: ['政策文件解析', '文本结构化提取', '公文写作助手'], accent: '#7c3aed' },
  { id: 'survey-quality', name: '国土调查成果质检专家团', summary: '由空间分析、数据质检和成果编制角色协同核查调查成果，形成问题清单和交付说明。', members: ['调查工程师', 'GIS 分析师', '成果质检员'], skills: ['GIS 图层合并', '数据清洗诊断', 'GIS 制图导出'], accent: '#059669' },
  { id: 'ecology-review', name: '生态保护修复论证专家团', summary: '将生态底图分析、政策约束识别与论证材料整理串联为项目论证工作流。', members: ['生态规划师', '空间分析师', '论证撰稿人'], skills: ['政策文件解析', '空间计量经济学', '咨询报告生成器'], accent: '#0ea5e9' },
  { id: 'farmland-review', name: '耕地保护合规审查专家团', summary: '围绕耕地保有量、永久基本农田占用与补划平衡，组织底图核对、政策比对与审查意见输出。', members: ['耕地保护专员', 'GIS 工程师', '执法督察员'], skills: ['GIS图层合并', '政策文件解析', 'GIS制图导出'], accent: '#65a30d' },
  { id: 'geohazard-assess', name: '地质灾害风险评估专家团', summary: '串联地质底图分析、隐患点叠加与风险评估报告编制，服务选址与防灾审查场景。', members: ['地质工程师', '空间分析师', '报告撰稿人'], skills: ['空间计量经济学', 'GIS制图导出', '咨询报告生成器'], accent: '#d97706' },
  { id: 'land-supply', name: '土地供应与利用协同专家团', summary: '覆盖储备整理、供地方案、批后监管与闲置处置，帮助形成供地全链条材料。', members: ['储备整理专员', '用地顾问', '政务撰稿人'], skills: ['公文写作助手', '政策文件解析', '文本结构化提取'], accent: '#0891b2' },
  { id: 'urban-renewal', name: '城市更新项目推进专家团', summary: '从更新单元划定、政策适用到实施方案与汇报材料，组织多角色协同推进。', members: ['更新规划师', '政策分析师', '政企协调员'], skills: ['咨询报告生成器', '政策文件解析', '规划案例比较分析'], accent: '#0d9488' },
]

const EXPERTS: readonly Expert[] = [
  { id: 'spatial-planning', name: '国土空间规划编制专家', role: '总体规划与详细规划顾问', category: '规划编制', summary: '协助梳理规划目标、空间格局、用地安排与成果章节，形成结构清晰的规划材料。', tags: ['规划编制', '空间布局', '成果框架'], examples: ['根据现有资料梳理国土空间总体规划的章节框架', '对这份详细规划文本提取主要管控要求'], accent: '#2563eb', icon: 'planning' },
  { id: 'land-approval', name: '建设用地报批专家', role: '用地合规与材料审查顾问', category: '用地报批', summary: '聚焦项目选址、用地审批要件与材料完整性，帮助识别报批前需补充的内容。', tags: ['用地报批', '合规核验', '材料清单'], examples: ['根据项目资料列出用地报批材料清单', '核查这份项目说明中可能影响报批的风险点'], accent: '#7c3aed', icon: 'policy' },
  { id: 'natural-resource-policy', name: '自然资源政策解读专家', role: '政策条款与执行口径顾问', category: '政策法规', summary: '将自然资源、规划、生态保护相关政策拆解为适用条件、责任事项和时间节点。', tags: ['政策解读', '条款比对', '执行口径'], examples: ['概述这份政策中与项目建设有关的约束', '对比两份通知的适用范围与新增要求'], accent: '#dc2626', icon: 'policy' },
  { id: 'gis-analysis', name: 'GIS 空间分析专家', role: '空间数据与制图分析顾问', category: '空间分析', summary: '面向 GeoJSON、图层和规划底图，组织范围核对、叠加分析与可视化成果说明。', tags: ['空间叠加', 'GIS 制图', '范围核验'], examples: ['根据这份 GeoJSON 说明可开展的空间分析', '整理多个图层的字段差异和合并建议'], accent: '#0ea5e9', icon: 'gis' },
  { id: 'land-survey', name: '国土调查监测专家', role: '调查成果与变化监测顾问', category: '调查监测', summary: '协助核对调查数据质量、变化图斑说明与三调相关成果的逻辑一致性。', tags: ['三调成果', '变化监测', '数据质检'], examples: ['检查调查成果表中需要重点复核的字段', '按图斑变化整理一份核查任务清单'], accent: '#059669', icon: 'survey' },
  { id: 'ecological-restoration', name: '生态修复论证专家', role: '生态保护与修复方案顾问', category: '生态保护', summary: '梳理生态保护红线、修复目标、工程措施与论证要点，辅助形成项目说明。', tags: ['生态修复', '保护约束', '方案论证'], examples: ['基于项目资料编制生态修复论证提纲', '提炼生态保护要求并列出需核实事项'], accent: '#16a34a', icon: 'ecology' },
  { id: 'property-registration', name: '不动产登记研判专家', role: '权属资料与登记流程顾问', category: '不动产登记', summary: '帮助整理权属资料、登记事项和疑点清单，便于与项目资料交叉核验。', tags: ['权属核验', '登记资料', '疑点清单'], examples: ['从这些权属资料中整理登记核验重点', '生成不动产登记资料的缺失项清单'], accent: '#b45309', icon: 'property' },
  { id: 'gov-writing', name: '政务材料与汇报专家', role: '政企沟通与成果表达顾问', category: '政务协同', summary: '将复杂项目资料整理为适用于汇报、请示、纪要和项目推进的规范化文字材料。', tags: ['政务写作', '项目汇报', '会议纪要'], examples: ['把项目进展整理为领导汇报提纲', '根据会议记录起草一份待办明确的纪要'], accent: '#e87922', icon: 'writing' },
  { id: 'farmland-protection', name: '耕地保护与永久基本农田专家', role: '耕地保有量与占补平衡顾问', category: '耕地地质', summary: '协助核对耕地保有量、永久基本农田占用与补划方案，梳理占补平衡与进出平衡要求。', tags: ['永久基本农田', '占补平衡', '进出平衡'], examples: ['核对这个项目是否涉及永久基本农田', '整理占补平衡方案需要说明的要点'], accent: '#65a30d', icon: 'ecology' },
  { id: 'geohazard', name: '地质灾害防治专家', role: '地灾评估与隐患核查顾问', category: '耕地地质', summary: '面向地质灾害危险性评估、隐患点核查与防治要求，辅助选址与审查意见整理。', tags: ['地灾评估', '隐患核查', '防灾审查'], examples: ['根据资料列出地灾评估需要收集的内容', '核查选址说明中的地质灾害风险表述'], accent: '#d97706', icon: 'survey' },
  { id: 'mineral-resource', name: '矿产资源管理专家', role: '矿政审批与压覆核查顾问', category: '耕地地质', summary: '协助梳理矿业权设置、压覆重要矿产资源核查与矿山生态修复要求。', tags: ['压覆核查', '矿业权', '矿山修复'], examples: ['整理建设项目压覆矿产资源核查清单', '说明矿山生态修复方案的主要章节'], accent: '#ca8a04', icon: 'gis' },
  { id: 'land-supply', name: '土地储备与供应专家', role: '储备整理与供地方案顾问', category: '供地与利用', summary: '覆盖土地储备计划、整理成本核算、供地方式选择与出让方案要点梳理。', tags: ['储备计划', '供地方案', '出让要点'], examples: ['梳理这块储备土地的供地方式选项', '整理出让方案需要明确的控制条件'], accent: '#0891b2', icon: 'property' },
  { id: 'idle-land', name: '闲置土地处置专家', role: '批后监管与闲置处置顾问', category: '供地与利用', summary: '协助认定闲置原因、梳理处置路径（延期、收回、置换等）与批后监管台账。', tags: ['闲置认定', '处置路径', '批后监管'], examples: ['根据项目时间线判断闲置认定节点', '比较这宗闲置土地可选的处置方式'], accent: '#4f46e5', icon: 'planning' },
  { id: 'enforcement', name: '自然资源执法督察专家', role: '违法线索研判与督察整改顾问', category: '执法督察', summary: '协助研判卫片执法线索、违法用地情形与督察整改销号材料要求。', tags: ['卫片执法', '线索研判', '整改销号'], examples: ['研判这个卫片图斑可能的违法情形', '整理督察整改销号需要的佐证材料'], accent: '#e11d48', icon: 'policy' },
  { id: 'urban-renewal', name: '城市更新规划专家', role: '更新单元与实施方案顾问', category: '规划编制', summary: '协助划定更新单元、梳理更新方式与实施方案框架，衔接国土空间规划管控要求。', tags: ['更新单元', '实施方案', '存量盘活'], examples: ['梳理这个片区的更新方式与实施路径', '对照总规核查更新单元的管控要求'], accent: '#0d9488', icon: 'planning' },
  { id: 'asset-accounting', name: '自然资源资产核算专家', role: '确权登记与资产清查顾问', category: '调查监测', summary: '协助全民所有自然资源资产清查、所有权委托代理与资产报告编制要点梳理。', tags: ['资产清查', '委托代理', '资产报告'], examples: ['整理资产清查需要归集的数据清单', '梳理所有权委托代理事项清单框架'], accent: '#9333ea', icon: 'survey' },
]

const CONNECTORS: readonly Connector[] = [
  { id: 'zj-dingtalk', name: '浙政钉', summary: '接入组织通讯录、待办与消息通知，将任务结果送达政务协同入口。', scope: '政务协同', accent: '#1677ff', icon: '/connector-icons/zj-dingtalk.svg', capabilities: ['待办推送', '组织通讯录', '消息通知'], access: '需由单位管理员完成组织授权' },
  { id: 'dingtalk', name: '钉钉', summary: '连接钉钉消息、日程、审批与待办，在任务完成后推送结果通知。', scope: '政务协同', accent: '#1677ff', icon: '/connector-icons/dingtalk.png', capabilities: ['消息推送', '审批同步', '日程提醒'], access: '按组织维度授权，支持随时取消' },
  { id: 'qq-mail', name: 'QQ 邮箱', summary: '在授权邮箱内检索邮件、形成摘要，并将结果保存为待发送草稿。', scope: '邮箱协作', accent: '#f5a700', icon: '/connector-icons/qq-mail.png', capabilities: ['邮件检索', '摘要提炼', '草稿交付'], access: '按邮箱账号授权，可随时取消' },
  { id: 'office-mail', name: '办公邮箱', summary: '读取和起草授权范围内的办公邮件，支持将审阅结果作为邮件草稿交付。', scope: '办公邮件', accent: '#0f766e', icon: '/connector-icons/office-mail.svg', capabilities: ['邮件读取', '草稿起草', '附件摘要'], access: 'OAuth 授权，不保存账号密码' },
  { id: 'internal-mail', name: '内部邮箱', summary: '适配内网 SMTP 或 Exchange 环境，专用于不出网的邮件通知与归档。', scope: '内网邮件', accent: '#7c3aed', icon: '/connector-icons/internal-mail.svg', capabilities: ['内网投递', '通知归档', '审批抄送'], access: '需管理员配置内网服务地址' },
  { id: 'feishu', name: '飞书', summary: '协助整理飞书文档、群消息和待办信息，支持将成果回写到协作空间。', scope: '团队协作', accent: '#00aeef', icon: '/connector-icons/feishu.png', capabilities: ['云文档', '群消息', '待办同步'], access: '仅访问你选择的工作空间内容' },
  { id: 'wecom', name: '企业微信', summary: '连接企业微信的消息、日程和审批通知，为内部协同提供统一入口。', scope: '内部协同', accent: '#2d8cf0', icon: '/connector-icons/wecom.png', capabilities: ['消息提醒', '审批通知', '日程同步'], access: '由企业管理员配置可用范围' },
  { id: 'tencent-docs', name: '腾讯文档', summary: '读取和整理在线文档、表格与收集表，适合多人协作的材料汇编。', scope: '在线文档', accent: '#00a6ff', icon: '/connector-icons/tencent-docs.png', capabilities: ['文档读取', '表格整理', '协作交付'], access: '通过个人授权访问指定文档' },
  { id: 'tencent-meeting', name: '腾讯会议', summary: '汇总会议日程与会议纪要，帮助将任务提醒推送给参会相关人员。', scope: '会议协同', accent: '#2f7cf6', icon: '/connector-icons/tencent-meeting.png', capabilities: ['会议日程', '纪要整理', '提醒推送'], access: '需要会议组织者或个人账号授权' },
  { id: 'aliyun-drive', name: '阿里云盘', summary: '在授权范围内读取与归档项目资料，支持大文件交付与版本管理。', scope: '云存储', accent: '#ff6a00', icon: '/connector-icons/aliyun-drive.png', capabilities: ['文件读取', '大文件交付', '版本归档'], access: '仅访问授权文件夹内容' },
  { id: 'baidu-map', name: '百度地图', summary: '调用地图服务能力进行地址解析、POI 检索与空间定位辅助。', scope: '地图服务', accent: '#4b85ef', icon: '/connector-icons/baidu-map.png', capabilities: ['地址解析', 'POI 检索', '坐标定位'], access: '按 Key 授权，不记录查询轨迹' },
  { id: 'amap', name: '高德地图', summary: '提供地理编码、路径规划和行政区划查询，辅助空间分析与选址论证。', scope: '地图服务', accent: '#2f8cee', icon: '/connector-icons/amap.png', capabilities: ['地理编码', '路径规划', '区划查询'], access: '按 Key 授权，不记录查询轨迹' },
  { id: 'doc-center', name: '政务文档中心', summary: '连接受控文档库，在授予的目录范围内检索、读取和提交交付物。', scope: '政务资料', accent: '#b45309', icon: '/connector-icons/doc-center.svg', capabilities: ['目录检索', '受控下载', '成果提交'], access: '按目录及文档权限控制访问' },
  { id: 'spatial-db', name: '空间数据库', summary: '连接 PostGIS / SDE 等空间数据库，读取要素类与属性表用于分析。', scope: '空间数据', accent: '#06b6d4', icon: '/connector-icons/spatial-db.svg', capabilities: ['要素读取', '空间查询', '属性关联'], access: '只读连接，不保存数据库凭据' },
  { id: 'pm-system', name: '项目管理系统', summary: '读取项目进度、任务分工与里程碑信息，生成项目跟踪与汇报材料。', scope: '项目管理', accent: '#8b5cf6', icon: '/connector-icons/pm-system.svg', capabilities: ['进度读取', '任务汇总', '里程碑跟踪'], access: '按项目授权访问可见范围' },
  { id: 'archive-system', name: '档案管理系统', summary: '按授权范围检索历史项目档案，支持资料调阅与成果归档。', scope: '档案管理', accent: '#6366f1', icon: '/connector-icons/archive-system.svg', capabilities: ['档案检索', '资料调阅', '成果归档'], access: '按档案密级与目录权限控制' },
]

const AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  { id: 'policy-brief', name: '每日政策与待办简报', summary: '在工作日早晨汇总待办、通知与已关注政策动态，生成可编辑简报。', trigger: '工作日 08:30', cadence: '每个工作日', scope: '当前工作区', steps: ['读取待办', '提炼政策', '生成简报'], accent: '#2563eb', prompt: '汇总当前工作区待办、已接入通知和近期政策要点，按重要程度生成一份每日简报，并标注需跟进事项。' },
  { id: 'tender-change', name: '投标文件变更提醒', summary: '关注招标文件与澄清答疑的变动，形成差异摘要并提示责任人。', trigger: '文件变更时', cadence: '检测到文件变更', scope: '投标工作区', steps: ['检测变更', '解析差异', '发送提醒'], accent: '#dc2626', prompt: '监测当前工作区中的招标文件、答疑和补充通知。如有更新，提取变更条款、影响范围和建议跟进人，输出变更提醒。' },
  { id: 'weekly-progress', name: '项目周报汇总', summary: '每周汇总工作区成果、进度和风险事项，生成 Word 周报草稿。', trigger: '每周五 16:30', cadence: '每周', scope: '当前工作区', steps: ['汇总成果', '提炼进展', '输出周报'], accent: '#059669', prompt: '收集本周工作区内的交付物、对话结论和待办进度，按完成事项、下周计划、风险与需协调事项生成项目周报草稿。' },
  { id: 'meeting-followup', name: '会议纪要待办跟进', summary: '会后整理纪要中的任务、负责人和时间节点，形成跟进清单。', trigger: '每个工作日 17:30', cadence: '每个工作日', scope: '行政复议', steps: ['读取纪要', '抽取待办', '更新清单'], accent: '#7c3aed', prompt: '整理当前工作区新增会议纪要，提取待办事项、负责人和截止时间，生成当日跟进清单；信息不明确时标注待确认。' },
  { id: 'document-archive', name: '成果归档检查', summary: '按项目目录检查交付成果是否完整，输出缺失文件和命名建议。', trigger: '每周四 15:00', cadence: '每周', scope: '项目成果目录', steps: ['扫描目录', '核对清单', '输出提醒'], accent: '#0ea5e9', prompt: '检查当前工作区成果目录中的报告、图件、数据和附件是否齐全，识别缺失项、重复文件与不规范命名，输出归档检查清单。' },
  { id: 'inbox-summary', name: '通知邮件摘要', summary: '汇总已授权来源的未读通知，按紧急程度形成简明处理建议。', trigger: '每个工作日 09:00', cadence: '每个工作日', scope: '已授权连接器', steps: ['读取通知', '判断优先级', '生成摘要'], accent: '#f59e0b', prompt: '汇总已授权消息和邮箱来源中的未读通知，按紧急、重要、一般分类，提取截止时间和建议处理动作，生成晨间摘要。' },
]

const AUTOMATION_HISTORY = [
  { id: 'run-01', name: '项目周报汇总', time: '今天 16:30', status: '已完成', detail: '已生成《项目周报草稿.docx》' },
  { id: 'run-02', name: '投标文件变更提醒', time: '昨天 10:12', status: '已完成', detail: '发现 2 处澄清变更，已生成差异摘要' },
  { id: 'run-03', name: '成果归档检查', time: '08-29 15:00', status: '需关注', detail: '发现 3 项待补充成果' },
] as const

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

function SparkleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5 14.4 9.6 21.5 12 14.4 14.4 12 21.5 9.6 14.4 2.5 12 9.6 9.6 Z" />
    </svg>
  )
}

/** Soft line glyph per skill category, tinted with the skill accent colour. */
function CategoryGlyph({ category, size = 20 }: { category: string; size?: number }) {
  const shared = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  switch (category) {
    case '空间制图':
      return <svg {...shared}><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" /><path d="M9 4v14M15 6v14" /></svg>
    case '专业写作':
      return <svg {...shared}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
    case '研究咨询':
      return <svg {...shared}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.35-4.35" /><path d="M8.5 11h5" /></svg>
    case '办公文档':
      return <svg {...shared}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M16 13H8M16 17H8" /></svg>
    case '数据分析':
      return <svg {...shared}><path d="M3 3v18h18" /><path d="M8 17v-5M13 17V8M18 17v-3" /></svg>
    default:
      return <SparkleIcon size={size} />
  }
}

const DEFAULT_SKILL_ICONS = [
  { value: 'preset:checklist', label: '文档整理', src: '/skill-icons/checklist.png' },
  { value: 'preset:batch-documents', label: '批量文档', src: '/skill-icons/batch-documents.png' },
  { value: 'preset:assistant', label: '智能助手', src: '/skill-icons/assistant.png' },
  { value: 'preset:document-settings', label: '文档配置', src: '/skill-icons/document-settings.png' },
  { value: 'preset:workflow', label: '工作流程', src: '/skill-icons/workflow.png' },
  { value: 'preset:analytics', label: '数据分析', src: '/skill-icons/analytics.png' },
  { value: 'preset:conversation', label: '沟通协作', src: '/skill-icons/conversation.png' },
  { value: 'preset:integration', label: '工具集成', src: '/skill-icons/integration.png' },
  { value: 'preset:cloud-upload', label: '云端上传', src: '/skill-icons/cloud-upload.png' },
  { value: 'preset:toolbox', label: '工具箱', src: '/skill-icons/toolbox.png' },
] as const

function DefaultSkillIcon({ icon, size = 20 }: { icon: string; size?: number }) {
  const preset = DEFAULT_SKILL_ICONS.find(item => item.value === icon)
  if (preset !== undefined) return <img className="dsh-skill-preset-icon" src={preset.src} alt="" width={size} height={size} />
  const shared = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  if (icon === 'glyph:map') return <svg {...shared}><path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Z" /><path d="M9 4v14M15 6v14" /></svg>
  if (icon === 'glyph:document') return <svg {...shared}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h8" /></svg>
  if (icon === 'glyph:chart') return <svg {...shared}><path d="M3 3v18h18" /><path d="M8 17v-5M13 17V8M18 17v-3" /></svg>
  if (icon === 'glyph:compass') return <svg {...shared}><circle cx="12" cy="12" r="9" /><path d="m15 9-2.2 4.8L8 16l2.2-4.8L15 9Z" /></svg>
  if (icon === 'glyph:lightning') return <svg {...shared}><path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z" /></svg>
  return <svg {...shared}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M8 12h.01M16 12h.01M9 16h6M12 2v3" /></svg>
}

function SkillVisual({ skill, size = 20 }: { skill: Skill; size?: number }) {
  if (skill.icon.startsWith('data:image/')) {
    return <img className="dsh-skill-custom-icon" src={skill.icon} alt="" />
  }
  if (skill.icon.startsWith('glyph:') || skill.icon.startsWith('preset:')) {
    return <DefaultSkillIcon icon={skill.icon} size={size} />
  }
  return <span className="dsh-skill-text-icon" style={{ fontSize: Math.max(13, size - 2) }}>{skill.icon || '技'}</span>
}

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  )
}

/** Visual identity for each marketplace capability in the sidebar and cards. */
function MarketplaceSectionIcon({ section, size = 18 }: { section: MarketplaceSection; size?: number }) {
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

  if (section === 'experts') {
    return <svg {...shared}><circle cx="12" cy="7" r="3" /><path d="M6.5 20c.4-3.4 2.2-5.2 5.5-5.2s5.1 1.8 5.5 5.2" /><circle cx="5" cy="10" r="2" /><path d="M2 18c.2-2.1 1.1-3.4 3-3.9" /><circle cx="19" cy="10" r="2" /><path d="M22 18c-.2-2.1-1.1-3.4-3-3.9" /></svg>
  }
  if (section === 'connectors') {
    return <svg {...shared}><path d="M8 7V4M12 7V4M6 7h8v4a4 4 0 0 1-8 0V7Z" /><path d="M10 15v2a3 3 0 0 0 3 3h3" /><path d="m16 17 3 3-3 3" /></svg>
  }
  if (section === 'automations') {
    return <svg {...shared}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.8 2" /><path d="m17.5 4 .7 1.8L20 6.5l-1.8.7-.7 1.8-.7-1.8L15.5 6.5l1.8-.7Z" /></svg>
  }
  return <SparkleIcon size={size} />
}

function ArrowLeftIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  )
}

type Controller = {
  open(): void
  close(): void
  toggle(): void
  isOpen(): boolean
  subscribe(listener: (state: { open: boolean }) => void): () => void
}

function createController(): Controller {
  const listeners = new Set<(state: { open: boolean }) => void>()
  let open = false
  const emit = (): void => { listeners.forEach((listener) => { listener({ open }) }) }
  const controller: Controller = {
    open: () => { open = true; emit() },
    close: () => { open = false; emit() },
    toggle: () => { open = !open; emit() },
    isOpen: () => open,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
  }
  return controller
}

// Each sidebar capability owns its own controller and overlay. This keeps
// navigation separate rather than treating the entries as product tabs.
const marketplaceControllers: Record<MarketplaceSection, Controller> = {
  skills: createController(),
  experts: createController(),
  connectors: createController(),
  automations: createController(),
}

type OverlayProps = PropsRuntime<'shell.overlay'> & {
  marketplaceUrl: string
  chooseDirectory: () => Promise<string | null>
}
type CustomSkillSource =
  | { kind: 'directory'; path: string }
  | { kind: 'archive'; name: string; bytes: number[] }
type ActionProps = PropsRuntime<'sidebar.footer.action'> & SidebarFooterActionOwnerProps

function SkillDetail({ skill, onBack, installState, installing, onToggleInstall, showReview = false }: {
  skill: Skill
  onBack: () => void
  installState: MarketplaceInstallState
  installing: boolean
  onToggleInstall: () => void
  showReview?: boolean
}) {
  const installed = installState === 'installed' || installState === 'updateAvailable'
  const installLabel = skill.installable !== true
    ? '暂未开放安装'
    : installState === 'updateAvailable'
      ? '更新技能'
      : installState === 'conflict'
        ? '存在同名本地技能'
        : installed ? L.uninstall : L.detailInstall
  return (
    <div className="dsh-skill-detail">
      <button type="button" className="dsh-skill-detail-back" onClick={onBack}>
        <ArrowLeftIcon /> {L.back}
      </button>
      <div className="dsh-skill-detail-header">
        <div className="dsh-skill-detail-icon" style={{ background: skill.accent + '1f', color: skill.accent }}>
          <SkillVisual skill={skill} size={28} />
        </div>
        <div className="dsh-skill-detail-info">
          <h1>{skill.name}</h1>
          <p>{skill.summary}</p>
          <div className="dsh-skill-detail-meta">
            <span className={`dsh-skill-source ${skill.source === 'personal' ? 'personal' : 'official'}`}>{skill.source === 'personal' ? '个人' : '官方'}</span>
            {showReview && skill.reviewStatus !== undefined && skill.reviewStatus !== 'none' && (
              <span className={`dsh-skill-review-status ${skill.reviewStatus}`}>{reviewStatusLabel(skill.reviewStatus)}</span>
            )}
            <span>{L.version}: {skill.version}</span>
            <span>{L.author}: {skill.author}</span>
            {hasVerifiedInstallCount(skill) && <span>{skill.installs} {L.count}</span>}
          </div>
        </div>
        <button
          type="button"
          className={`dsh-skill-detail-install${installed ? ' installed' : ''}`}
          onClick={onToggleInstall}
          disabled={installing || skill.installable !== true || installState === 'conflict'}
        >
          {installing ? '处理中…' : installLabel}
        </button>
      </div>
      {showReview && skill.reviewStatus === 'rejected' && skill.reviewReason && (
        <div className="dsh-skill-review-notice">审核意见：{skill.reviewReason}</div>
      )}
      <div className="dsh-skill-detail-body">
        <div className="dsh-skill-detail-section">
          <h3>{L.params}</h3>
          {skill.params && skill.params.length > 0 ? (
            <div className="dsh-skill-detail-params">
              {skill.params.map((param, idx) => (
                <div key={idx} className="dsh-skill-detail-param">
                  <div className="dsh-skill-detail-param-name">
                    {param.name}
                    {param.required && <span className="required">*</span>}
                    <span className="type">{param.type}</span>
                  </div>
                  <div className="dsh-skill-detail-param-desc">{param.description}</div>
                  {param.defaultValue && (
                    <div className="dsh-skill-detail-param-default">
                      默认值: {param.defaultValue}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="dsh-skill-detail-no-params">{L.noParams}</p>
          )}
        </div>
        <div className="dsh-skill-detail-section">
          <h3>详细描述</h3>
          <p>{skill.description}</p>
        </div>
      </div>
    </div>
  )
}

/* oxlint-disable @stylistic/arrow-parens, @stylistic/max-len -- compact local-only interaction trees keep cards and dialogs together. */
function ExpertAvatar({ expert }: { expert: Expert }) {
  const shared = { width: 28, height: 28, viewBox: '0 0 28 28', fill: 'none', 'aria-hidden': true }
  if (expert.icon === 'planning') return <svg {...shared}><path d="M5 22V9l9-4 9 4v13" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M9 22v-6h10v6M10 10h.1M14 10h.1M18 10h.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  if (expert.icon === 'policy') return <svg {...shared}><path d="M8 4h10l4 4v15H8z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M18 4v5h4M11 14h8M11 18h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  if (expert.icon === 'gis') return <svg {...shared}><path d="m5 8 7-3 5 3 6-3v15l-6 3-5-3-7 3V8Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M12 5v15M17 8v15" stroke="currentColor" strokeWidth="2" /></svg>
  if (expert.icon === 'survey') return <svg {...shared}><circle cx="14" cy="14" r="8" stroke="currentColor" strokeWidth="2" /><path d="M14 6v3M14 19v3M6 14h3M19 14h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  if (expert.icon === 'ecology') return <svg {...shared}><path d="M21 5c-9 .4-14 5-14 12 0 3.4 2.5 5.8 5.6 5.8C19 22.8 22 15.7 21 5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M8 20c3-3.8 6.1-6.3 10.4-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  if (expert.icon === 'property') return <svg {...shared}><path d="m5 13 9-8 9 8v10H5V13Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M11 23v-6h6v6" stroke="currentColor" strokeWidth="2" /></svg>
  return <svg {...shared}><path d="M7 5h14v18H7z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M10 10h8M10 14h8M10 18h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
}

type ExpertMarketDetail = { name: string; role: string; summary: string; tags: readonly string[]; examples: readonly string[]; accent: string; members?: readonly string[]; skills?: readonly string[] }

function ExpertMarket() {
  const [tab, setTab] = useState<'experts' | 'teams'>('experts')
  const [category, setCategory] = useState('全部')
  const [selected, setSelected] = useState<ExpertMarketDetail | null>(null)
  const categories = ['全部', '规划编制', '用地报批', '政策法规', '空间分析', '调查监测', '生态保护', '耕地地质', '供地与利用', '执法督察', '不动产登记', '政务协同']
  const visibleExperts = category === '全部' ? EXPERTS : EXPERTS.filter(expert => expert.category === category)
  const openExpert = (expert: Expert) => setSelected({ name: expert.name, role: expert.role, summary: expert.summary, tags: expert.tags, examples: expert.examples, accent: expert.accent })
  const openTeam = (team: ExpertTeam) => setSelected({ name: team.name, role: '多角色协同工作流', summary: team.summary, tags: team.members, examples: ['根据当前工作区资料启动该专家团审查', '为该专家团补充本项目的交付要求'], accent: team.accent, members: team.members, skills: team.skills })
  return <section className="dsh-expert-market">
    <nav className="dsh-expert-tabs" aria-label="专家库内容"><button type="button" className={tab === 'experts' ? 'active' : ''} onClick={() => setTab('experts')}>专家</button><button type="button" className={tab === 'teams' ? 'active' : ''} onClick={() => setTab('teams')}>专家团</button></nav>
    {tab === 'experts' && <><div className="dsh-expert-category-row">{categories.map(item => <button type="button" key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div><div className="dsh-expert-grid">{visibleExperts.map(expert => <button type="button" className="dsh-expert-card" key={expert.id} onClick={() => openExpert(expert)}><span className="dsh-expert-avatar" style={{ background: `${expert.accent}18`, color: expert.accent }}><ExpertAvatar expert={expert} /></span><div><strong>{expert.name}</strong><small>{expert.role}</small></div><p>{expert.summary}</p><footer>{expert.tags.map(tag => <b key={tag}>{tag}</b>)}</footer></button>)}</div></>}
    {tab === 'teams' && <div className="dsh-expert-grid teams">{EXPERT_TEAMS.map(team => <button type="button" className="dsh-expert-card" key={team.id} onClick={() => openTeam(team)}><span className="dsh-expert-avatar" style={{ background: `${team.accent}18`, color: team.accent }}><MarketplaceSectionIcon section="experts" size={25} /></span><div><strong>{team.name}</strong><small>多角色协同工作流</small></div><p>{team.summary}</p><footer>{team.members.slice(0, 3).map(member => <b key={member}>{member}</b>)}<b>+{team.members.length}</b></footer></button>)}</div>}
    {selected !== null && <div className="dsh-expert-modal-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) setSelected(null) }}><section className="dsh-expert-detail" aria-label={`${selected.name}详情`}><header><div><span style={{ background: `${selected.accent}18`, color: selected.accent }}><MarketplaceSectionIcon section="experts" size={24} /></span><div><h2>{selected.name}</h2><p>{selected.role}</p></div></div><button type="button" onClick={() => setSelected(null)} aria-label="关闭">×</button></header><p className="dsh-expert-detail-summary">{selected.summary}</p><div className="dsh-expert-detail-block"><span>{selected.members === undefined ? '专业方向' : '协作角色'}</span><div>{selected.tags.map(tag => <b key={tag}>{tag}</b>)}</div></div>{selected.skills !== undefined && <div className="dsh-expert-detail-block"><span>编排技能</span><div>{selected.skills.map(skill => <b key={skill}>{skill}</b>)}</div></div>}<div className="dsh-expert-detail-block examples"><span>可以这样开始</span>{selected.examples.map(example => <p key={example}>“{example}”</p>)}</div><footer><small>当前为专家库演示，不会启动实际多 Agent 协作。</small><button type="button" onClick={() => window.alert(`已为“${selected.name}”准备演示任务草稿。`)}>创建演示任务</button></footer></section></div>}
  </section>
}

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
  const requestAccess = (connector: Connector) => setRequested(current => new Set(current).add(connector.id))
  const saveCustomConnector = () => {
    const name = customName.trim()
    if (name === '') return
    const connector = { id: `custom-${Date.now()}`, name, summary: customDescription.trim() || '这是一个保存在本机演示列表中的自定义连接器。', scope: customCategory, accent: '#4969d8', icon: '/connector-icons/plug.svg', capabilities: ['连接说明', '访问范围', '使用提醒'], access: '演示阶段不会发起网络连接或保存凭据' }
    setCustomConnectors(items => [connector, ...items])
    setCustomName('')
    setCustomDescription('')
    setShowCustom(false)
    setSelected(connector)
  }
  return <section className="dsh-connectors-page">
    <div className="dsh-connectors-toolbar"><button type="button" onClick={() => setShowCustom(true)}><PlusIcon /> 自定义连接器</button></div>
    <div className="dsh-connectors-grid">
      {connectors.map(connector => <button type="button" className="dsh-connector-card" key={connector.id} onClick={() => setSelected(connector)}>
        <div className="dsh-connector-card-top"><ConnectorBrandIcon icon={connector.icon} accent={connector.accent} /><span>{connector.scope}</span></div>
        <strong>{connector.name}</strong><p>{connector.summary}</p>
        <small>{requested.has(connector.id) ? '已保存申请' : '点击查看接入详情'}</small><i aria-hidden="true">›</i>
      </button>)}
    </div>
    {selected !== null && <div className="dsh-connector-modal-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) setSelected(null) }}><section className="dsh-connector-detail" aria-label={`${selected.name}连接器详情`}><header><div><ConnectorBrandIcon icon={selected.icon} accent={selected.accent} /><div><h2>{selected.name}</h2><p>{selected.scope} · 本地演示目录</p></div></div><button type="button" onClick={() => setSelected(null)} aria-label="关闭">×</button></header><p className="dsh-connector-detail-summary">{selected.summary}</p><div className="dsh-connector-detail-block"><span>可协助完成</span><div>{selected.capabilities.map(item => <b key={item}>{item}</b>)}</div></div><div className="dsh-connector-detail-block"><span>接入说明</span><p>{selected.access}</p></div><footer><small>接入后仅在授权范围内访问数据。</small><button type="button" className={requested.has(selected.id) ? 'requested' : ''} onClick={() => requestAccess(selected)}>{requested.has(selected.id) ? '已提交申请' : '申请接入'}</button></footer></section></div>}
    {showCustom && <div className="dsh-connector-modal-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) setShowCustom(false) }}><form className="dsh-connector-custom" onSubmit={event => { event.preventDefault(); saveCustomConnector() }}><header><div><h2>自定义连接器</h2><p>添加团队内部服务说明，当前仅保存在本机演示列表。</p></div><button type="button" onClick={() => setShowCustom(false)} aria-label="关闭">×</button></header><label>连接器名称<input autoFocus value={customName} onChange={event => setCustomName(event.target.value)} placeholder="例如：项目资料共享库" /></label><label>服务类型<select value={customCategory} onChange={event => setCustomCategory(event.target.value)}><option>协同办公</option><option>文档服务</option><option>邮箱服务</option><option>内部数据</option></select></label><label>用途说明<textarea value={customDescription} onChange={event => setCustomDescription(event.target.value)} placeholder="说明它能帮助处理哪些资料或协作事项" /></label><div className="dsh-connector-custom-tip">暂不要求填写地址、密钥或账户信息；正式接入时将由管理员统一配置。</div><footer><button type="button" onClick={() => setShowCustom(false)}>取消</button><button type="submit" disabled={customName.trim() === ''}>添加到演示列表</button></footer></form></div>}
  </section>
}

function Automations() {
  const [tab, setTab] = useState<'configured' | 'history' | 'templates'>('configured')
  const [selected, setSelected] = useState<AutomationTemplate | null>(null)
  const [draft, setDraft] = useState<AutomationDraft | null>(null)
  const [configured, setConfigured] = useState<AutomationDraft[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const openManual = () => setDraft({ id: `manual-${Date.now()}`, name: '', cadence: '每个工作日', time: '09:00', prompt: '', source: '手动' })
  const openTemplate = (template: AutomationTemplate) => {
    setSelected(template)
    setDraft({ id: template.id, name: template.name, cadence: template.cadence, time: template.trigger.split(' ').at(-1) ?? '09:00', prompt: template.prompt, source: '模板' })
  }
  const saveDraft = () => {
    if (draft === null || draft.name.trim() === '' || draft.prompt.trim() === '') return
    setConfigured(items => [{ ...draft, name: draft.name.trim(), prompt: draft.prompt.trim() }, ...items.filter(item => item.id !== draft.id)])
    setDraft(null)
    setSelected(null)
    setTab('configured')
    setNotice('自动化任务已保存到本地演示列表，当前不会实际执行。')
  }
  const startConversation = () => setNotice('已准备自动化创建草稿；正式接入后将新建对话并自动填入任务内容。')
  return <section className="dsh-automation-page">
    <div className="dsh-automation-actions">
      <button type="button" onClick={openManual}>手动新建</button>
      <button type="button" className="primary" onClick={startConversation}><PlusIcon /> 在对话中创建</button>
    </div>
    <nav className="dsh-automation-tabs" aria-label="自动化页面">
      <button type="button" className={tab === 'configured' ? 'active' : ''} onClick={() => setTab('configured')}>已配置<span>{configured.length}</span></button>
      <button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>执行历史</button>
      <button type="button" className={tab === 'templates' ? 'active' : ''} onClick={() => setTab('templates')}>任务模板</button>
    </nav>
    {notice !== null && <div className="dsh-automation-notice">{notice}<button type="button" onClick={() => setNotice(null)}>×</button></div>}
    {tab === 'configured' && (configured.length === 0 ? <div className="dsh-automation-empty"><div><MarketplaceSectionIcon section="automations" size={30} /></div><h2>尚未配置自动化</h2><p>从工作模板开始，建立适合当前工作区的周期任务。</p><button type="button" onClick={() => setTab('templates')}>从模板创建</button></div> : <div className="dsh-automation-configured">{configured.map(item => <article key={item.id}><div className="dsh-automation-configured-icon"><MarketplaceSectionIcon section="automations" size={19} /></div><div><h2>{item.name}</h2><p>{item.cadence} · {item.time} · {item.source}创建</p><small>{item.prompt}</small></div><span>演示模式</span></article>)}</div>)}
    {tab === 'history' && <div className="dsh-automation-history">{AUTOMATION_HISTORY.map(item => <article key={item.id}><div><strong>{item.name}</strong><span>{item.time}</span></div><p>{item.detail}</p><b className={item.status === '需关注' ? 'attention' : ''}>{item.status}</b></article>)}</div>}
    {tab === 'templates' && <div className="dsh-automation-template-grid">{AUTOMATION_TEMPLATES.map(item => <button type="button" className="dsh-automation-template" key={item.id} onClick={() => openTemplate(item)}><div className="dsh-automation-template-icon" style={{ background: item.accent }}><MarketplaceSectionIcon section="automations" size={20} /></div><strong>{item.name}</strong><span>{item.trigger}</span><p>{item.summary}</p><small>{item.scope}</small></button>)}</div>}
    {draft !== null && <div className="dsh-automation-modal-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) { setDraft(null); setSelected(null) } }}><form className="dsh-automation-modal" onSubmit={event => { event.preventDefault(); saveDraft() }}><header><div><span>{selected === null ? '新建自动化任务' : '从任务模板创建'}</span><small>{selected === null ? '配置一个仅保存在本机演示列表中的任务。' : selected.summary}</small></div><button type="button" onClick={() => { setDraft(null); setSelected(null) }} aria-label="关闭">×</button></header><label>任务名称<input autoFocus value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="例如：项目周报汇总" /></label><div className="dsh-automation-schedule"><label>触发频率<select value={draft.cadence} onChange={event => setDraft({ ...draft, cadence: event.target.value })}><option>每个工作日</option><option>每天</option><option>每周</option><option>文件变更时</option></select></label><label>执行时间<input type="time" value={draft.time} onChange={event => setDraft({ ...draft, time: event.target.value })} disabled={draft.cadence === '文件变更时'} /></label></div><label>任务说明<textarea value={draft.prompt} onChange={event => setDraft({ ...draft, prompt: event.target.value })} placeholder="描述希望智能体按计划完成的工作" /></label><div className="dsh-automation-modal-tip">演示阶段仅展示配置流程，不会创建定时任务或调用外部连接器。</div><footer><button type="button" onClick={() => { setDraft(null); setSelected(null) }}>取消</button><button type="submit" disabled={draft.name.trim() === '' || draft.prompt.trim() === ''}>保存任务</button></footer></form></div>}
  </section>
}
/* oxlint-enable @stylistic/arrow-parens, @stylistic/max-len */

function SkillCategorySelect({
  options,
  value,
  onChange,
}: {
  options: readonly string[]
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const disabled = options.length === 0

  return (
    <span
      className={`dsh-skill-add-select-shell${open ? ' open' : ''}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button
        type="button"
        className="dsh-skill-add-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => { setOpen(current => !current) }}
      >
        <span>{disabled ? '暂无可用分类' : value}</span>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
      </button>
      {open && (
        <span className="dsh-skill-add-select-options" role="listbox" aria-label="技能分类">
          {options.map(option => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === value}
              className={option === value ? 'active' : ''}
              onClick={() => { onChange(option); setOpen(false) }}
            >
              {option}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

function SkillMarketplace({ section, chooseDirectory }: OverlayProps & { section: MarketplaceSection }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(L.all)
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)
  const [libraryView, setLibraryView] = useState<'market' | 'installed' | 'uploads'>('market')
  const [uploadView, setUploadView] = useState<PersonalSkillUploadView>('public')
  const [reviewFilter, setReviewFilter] = useState<PersonalSkillReviewFilter>('all')
  const [installing, setInstalling] = useState<string | null>(null)
  const [installMessage, setInstallMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [customSkills, setCustomSkills] = useState<Skill[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('dsh.marketplace.custom-skills') ?? '[]') as Skill[]
    } catch {
      return []
    }
  })
  const [discoveredCustomStates, setDiscoveredCustomStates] = useState<CustomSkillState[]>([])
  const [adding, setAdding] = useState(false)
  const [newSkill, setNewSkill] = useState({ name: '', summary: '', category: '', icon: 'preset:assistant', visibility: 'private' as 'private' | 'public' })
  const [customSkillSource, setCustomSkillSource] = useState<CustomSkillSource | null>(null)
  const [remoteSkills, setRemoteSkills] = useState<RemoteSkill[] | null>(null)
  const [remoteCategories, setRemoteCategories] = useState<RemoteSkillCategory[] | null>(null)
  const [personalSkills, setPersonalSkills] = useState<RemotePersonalSkill[]>([])

  const [installStates, setInstallStates] = useState<Map<string, MarketplaceSkillState>>(new Map())
  const refreshInstallStates = async () => {
    try {
      const [value, customValue] = await Promise.all([
        desktopInvoke('list_marketplace_skills', {}),
        desktopInvoke('list_custom_skills', {}),
      ])
      if (!Array.isArray(value)) return
      const states = value.filter((item): item is MarketplaceSkillState => {
        if (typeof item !== 'object' || item === null) return false
        const candidate = item as Partial<MarketplaceSkillState>
        return typeof candidate.id === 'string' && typeof candidate.slug === 'string'
          && typeof candidate.version === 'string' && typeof candidate.state === 'string'
      })
      const customEntries = Array.isArray(customValue)
        ? customValue.filter((item): item is CustomSkillState => typeof item === 'object' && item !== null
          && typeof (item as Partial<CustomSkillState>).slug === 'string'
          && typeof (item as Partial<CustomSkillState>).name === 'string'
          && typeof (item as Partial<CustomSkillState>).description === 'string')
        : []
      setDiscoveredCustomStates(customEntries)
      const customStates = customEntries
        .map(item => [`local-${item.slug}`, { id: `local-${item.slug}`, slug: item.slug, version: '1.0.0', installedVersion: '1.0.0', state: 'installed' as const }] as const)
      setInstallStates(new Map([
        ...customStates,
        ...states.map(state => [state.id, state] as const),
      ]))
    } catch {
      // Browser previews have no native bridge; installation remains unavailable there.
    }
  }

  useEffect(() => marketplaceControllers[section].subscribe((next) => {
    setOpen(next.open)
    if (next.open) {
      if (section === 'skills') {
        setLibraryView('market')
        setView('list')
        setSelectedSkill(null)
        setQuery('')
        setCategory(L.all)
        void refreshInstallStates()
        if (loadRemoteSkills !== undefined) void loadRemoteSkills().then(setRemoteSkills).catch(() => setRemoteSkills(null))
        if (loadRemoteCategories !== undefined) void loadRemoteCategories().then(setRemoteCategories).catch(() => setRemoteCategories(null))
        if (loadPersonalSkills !== undefined) void loadPersonalSkills().then(setPersonalSkills).catch(() => setPersonalSkills([]))
      }
      // Only one capability panel may be expanded: opening this section
      // collapses the others, otherwise stacked overlays block each other
      // and switching between entries reads as unresponsive.
      for (const [name, controller] of Object.entries(marketplaceControllers)) {
        if (name !== section) controller.close()
      }
    }
    if (!next.open) {
      setView('list')
      setSelectedSkill(null)
    }
  }), [])

  // The marketplace deliberately leaves the sidebar usable.  Selecting a
  // sidebar command other than this section's own toggle should therefore
  // also leave this overlay immediately; operators should not have to find
  // the return arrow first.  The own entry toggles the panel instead, so its
  // pointerdown must not force a close here.
  useEffect(() => {
    if (!open) return
    const closeForSidebarAction = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('.dsh-skill-market-panel') !== null) return
      if (target.closest('.dsh-skill-market-action') !== null) return
      marketplaceControllers[section].close()
    }
    document.addEventListener('pointerdown', closeForSidebarAction, true)
    return () => { document.removeEventListener('pointerdown', closeForSidebarAction, true) }
  }, [open])

  const discoveredCustomSkills = useMemo<Skill[]>(() => {
    const cachedBySlug = new Map(customSkills.map(skill => [skillSlug(skill), skill]))
    const uploadedBySlug = new Map(personalSkills.flatMap((remote): Array<[string, RemotePersonalSkill]> => {
      const slug = typeof remote.name === 'string' ? remote.name : ''
      return slug === '' ? [] : [[slug, remote]]
    }))
    return discoveredCustomStates.map((item): Skill => {
      const cached = cachedBySlug.get(item.slug)
      const uploaded = uploadedBySlug.get(item.slug)
      const category = typeof uploaded?.category === 'string' && uploaded.category.trim() !== ''
        ? uploaded.category.trim()
        : cached?.category ?? '本地技能'
      const displayName = typeof uploaded?.display_name === 'string' && uploaded.display_name.trim() !== ''
        ? uploaded.display_name.trim()
        : cached?.name ?? item.name
      const description = typeof uploaded?.description === 'string' && uploaded.description.trim() !== ''
        ? uploaded.description.trim()
        : cached?.summary ?? item.description
      const icon = typeof uploaded?.icon === 'string' && uploaded.icon.trim() !== ''
        ? uploaded.icon
        : cached?.icon ?? 'preset:assistant'
      return {
        ...(cached ?? {}),
        id: `local-${item.slug}`,
        slug: item.slug,
        name: displayName,
        category,
        categories: [category],
        tags: ['本地', '个人'],
        summary: description,
        description,
        installs: '0',
        accent: '#2563eb',
        icon,
        version: cached?.version ?? '1.0.0',
        author: cached?.author ?? '当前用户',
        source: 'personal',
        installable: true,
        marketplacePublished: false,
      }
    })
  }, [customSkills, discoveredCustomStates, personalSkills])
  const allSkills = useMemo<Skill[]>(() => {
    const published = remoteSkills?.flatMap((remote): Skill[] => {
      const slug = typeof remote.name === 'string' ? remote.name : ''
      if (slug === '') return []
      const remoteId = typeof remote.id === 'number' || typeof remote.id === 'string' ? String(remote.id) : slug
      const source = remote.source === 'personal' ? 'personal' : 'official'
      const remoteTags = Array.isArray(remote.tags) ? remote.tags.filter((tag): tag is string => typeof tag === 'string') : []
      const relationCategories = publishedSkillCategories(remote.categories)
      const legacyCategory = typeof remote.category === 'string' && remote.category.trim() !== '' ? remote.category.trim() : '未分类'
      const categories = relationCategories.length > 0 ? relationCategories : [legacyCategory]
      return [{
        id: `remote-${remoteId}`,
        ...(typeof remote.id === 'number' ? { remoteId: remote.id } : {}),
        slug,
        name: typeof remote.display_name === 'string' && remote.display_name !== '' ? remote.display_name : slug,
        category: categories[0] ?? legacyCategory,
        categories,
        tags: [...new Set([...remoteTags, source === 'personal' ? '个人' : '官方'])],
        summary: typeof remote.description === 'string' ? remote.description : '',
        description: typeof remote.scenario === 'string' && remote.scenario !== '' ? remote.scenario : (typeof remote.description === 'string' ? remote.description : ''),
        installs: String(typeof remote.downloads === 'number' ? remote.downloads : 0),
        accent: '#2563eb', icon: typeof remote.icon === 'string' && remote.icon.trim() !== '' ? remote.icon : 'preset:assistant', version: typeof remote.version === 'string' ? remote.version : '1.0.0',
        author: typeof remote.submitter === 'string' ? remote.submitter : '平台管理员',
        source,
        installable: true,
        marketplacePublished: true,
      }]
    }) ?? null
    return buildMarketplaceCatalog(discoveredCustomSkills, published)
  }, [discoveredCustomSkills, remoteSkills])
  const uploadedSkills = useMemo<Skill[]>(() => personalSkills.flatMap((remote): Skill[] => {
    const slug = typeof remote.name === 'string' ? remote.name : ''
    const visibility = remote.visibility === 'public' ? 'public' : remote.visibility === 'private' ? 'private' : undefined
    const reviewStatus = parseReviewStatus(remote.review_status)
    if (slug === '' || visibility === undefined || reviewStatus === undefined) return []
    const id = typeof remote.id === 'number' || typeof remote.id === 'string' ? String(remote.id) : slug
    const categoryName = typeof remote.category === 'string' && remote.category.trim() !== ''
      ? remote.category.trim()
      : '未分类'
    const submittedAt = parseReviewTime(remote.submitted_at, remote.updated_at, remote.created_at)
    const reviewedAt = parseReviewTime(remote.reviewed_at)
    return [{
      id: `upload-${id}`,
      slug,
      name: typeof remote.display_name === 'string' && remote.display_name.trim() !== '' ? remote.display_name : slug,
      category: categoryName,
      categories: [categoryName],
      tags: ['个人'],
      summary: typeof remote.description === 'string' ? remote.description : '',
      description: typeof remote.description === 'string' ? remote.description : '',
      installs: '0',
      accent: '#2563eb',
      icon: typeof remote.icon === 'string' && remote.icon.trim() !== '' ? remote.icon : 'preset:assistant',
      version: typeof remote.version === 'string' && remote.version !== '' ? remote.version : '1.0.0',
      author: typeof remote.owner === 'string' && remote.owner !== '' ? remote.owner : '当前用户',
      source: 'personal',
      installable: true,
      marketplacePublished: visibility === 'public' && reviewStatus === 'approved',
      visibility,
      reviewStatus,
      ...(typeof remote.review_reason === 'string' && remote.review_reason.trim() !== ''
        ? { reviewReason: remote.review_reason.trim() }
        : {}),
      ...(submittedAt === undefined ? {} : { submittedAt }),
      ...(reviewedAt === undefined ? {} : { reviewedAt }),
      ...(typeof remote.published_skill_id === 'number' ? { publishedSkillId: remote.published_skill_id } : {}),
      ...(typeof remote.published_version === 'string' ? { publishedVersion: remote.published_version } : {}),
    }]
  }), [personalSkills])
  const reviewCounts = useMemo(() => countPersonalSkillReviews(uploadedSkills), [uploadedSkills])
  const uploadAttentionCount = reviewCounts.pending + reviewCounts.rejected
  const categories = useMemo(() => [
    L.all,
    ...buildMarketplaceCategories(remoteCategories),
  ], [remoteCategories])
  useEffect(() => {
    if (!categories.includes(category)) setCategory(L.all)
    const selectable = categories[1]
    if (selectable !== undefined && !categories.slice(1).includes(newSkill.category)) {
      setNewSkill(current => ({ ...current, category: selectable }))
    }
  }, [categories, category, newSkill.category])
  const resolveInstallState = (skill: Skill): MarketplaceInstallState => {
    const state = installStates.get(skill.id) ?? [...installStates.values()].find(item => item.slug === skillSlug(skill))
    if (state === undefined) return 'notInstalled'
    if (state.state !== 'installed' && state.state !== 'updateAvailable') return state.state
    return state.installedVersion === skill.version ? 'installed' : 'updateAvailable'
  }
  const isInstalled = (skill: Skill): boolean => {
    const state = resolveInstallState(skill)
    return state === 'installed' || state === 'updateAvailable'
  }
  const featuredPool = useMemo(() => browseMarketplaceCatalog(allSkills), [allSkills])
  const [featuredOffset, setFeaturedOffset] = useState(() => Math.floor(Math.random() * 10_000))
  const featuredSkills = useMemo(() => {
    if (featuredPool.length <= 3) return featuredPool
    const start = featuredOffset % featuredPool.length
    const step = Math.max(1, Math.floor(featuredPool.length / 3))
    return [0, 1, 2]
      .map(i => featuredPool[(start + i * step) % featuredPool.length])
      .filter((skill): skill is Skill => skill !== undefined)
  }, [featuredPool, featuredOffset])

  const visible = useMemo(() => {
    if (libraryView === 'uploads') {
      const uploads = filterPersonalSkillUploads(uploadedSkills, uploadView, reviewFilter)
      if (query.trim() === '') return uploads
      const q = query.trim().toLowerCase()
      return uploads.filter(skill => `${skill.name} ${skill.summary} ${skill.category}`.toLowerCase().includes(q))
    }
    let skills = libraryView === 'installed' ? [...allSkills] : browseMarketplaceCatalog(allSkills)
    if (libraryView === 'market' && category !== L.all) {
      skills = skills.filter(s => (s.categories ?? [s.category]).includes(category))
    }
    if (query.trim() !== '') {
      const q = query.trim().toLowerCase()
      skills = skills.filter(s => `${s.name} ${s.summary} ${s.category}`.toLowerCase().includes(q))
    }
    if (libraryView === 'installed') skills = skills.filter(isInstalled)
    return skills
  }, [allSkills, category, query, libraryView, uploadView, reviewFilter, uploadedSkills, installStates])

  if (!open) return null

  const closeMarket = () => { setOpen(false); marketplaceControllers[section].close() }

  const toggleInstall = async (skill: Skill) => {
    if (installing !== null) return
    if (skill.installable !== true) {
      setInstallMessage({ kind: 'error', text: '该技能暂未提供可安装的技能包。' })
      return
    }
    const slug = skillSlug(skill)
    const currentState = resolveInstallState(skill)
    const action = marketplaceInstallAction(currentState)
    setInstallMessage(null)
    setInstalling(skill.id)
    try {
      if (skill.tags.includes('本地') && action === 'uninstall') {
        await desktopInvoke('uninstall_custom_skill', { slug })
        const next = customSkills.filter(item => item.id !== skill.id)
        setCustomSkills(next)
        setDiscoveredCustomStates(previous => previous.filter(item => item.slug !== slug))
        localStorage.setItem('dsh.marketplace.custom-skills', JSON.stringify(next))
        setView('list')
        setSelectedSkill(null)
      } else if (action === 'uninstall') {
        await desktopInvoke('uninstall_marketplace_skill', { slug })
      } else {
        const bundle = skill.remoteId !== undefined && loadRemoteSkillBundle !== undefined
          ? serverSkillFiles(await loadRemoteSkillBundle(skill.remoteId))
          : undefined
        if (skill.remoteId !== undefined && bundle?.sha256 === undefined) throw new Error('服务器返回的技能包缺少 SHA-256 摘要')
        await desktopInvoke('install_marketplace_skill', { slug, files: bundle?.files, sha256: bundle?.sha256 })
        if (skill.remoteId !== undefined && recordRemoteSkillInstall !== undefined) {
          try {
            await recordRemoteSkillInstall(skill.remoteId)
            if (loadRemoteSkills !== undefined) setRemoteSkills(await loadRemoteSkills())
          } catch {
            // The completed local installation remains valid when telemetry is unavailable.
          }
        }
      }
    } catch (error) {
      setInstallMessage({ kind: 'error', text: marketplaceInstallErrorMessage(error) })
      return
    } finally {
      setInstalling(null)
    }
    await refreshInstallStates()
    setInstallMessage(action === 'update'
      ? { kind: 'success', text: '技能已更新，当前会话下一次输入 / 即可使用。' }
      : action === 'install'
        ? { kind: 'success', text: '技能已安装，当前会话下一次输入 / 即可使用。' }
        : { kind: 'success', text: '技能已从本机移除。' })
  }

  const selectCustomSkillDirectory = async () => {
    try {
      const directory = await chooseDirectory()
      if (directory !== null) setCustomSkillSource({ kind: 'directory', path: directory })
    } catch (error) {
      setInstallMessage({ kind: 'error', text: marketplaceInstallErrorMessage(error) })
    }
  }

  const selectCustomSkillArchive = async (file: File | undefined) => {
    if (file === undefined) return
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setInstallMessage({ kind: 'error', text: '请选择 ZIP 格式的个人技能包。' })
      return
    }
    if (file.size > 16 * 1024 * 1024) {
      setInstallMessage({ kind: 'error', text: '个人技能 ZIP 不能超过 16 MB。' })
      return
    }
    setCustomSkillSource({ kind: 'archive', name: file.name, bytes: [...new Uint8Array(await file.arrayBuffer())] })
  }

  const createSkill = async () => {
    const name = newSkill.name.trim()
    if (name === '' || customSkillSource === null) return
    setInstalling('custom-skill-import')
    let installed: CustomSkillState
    try {
      const value = customSkillSource.kind === 'directory'
        ? await desktopInvoke('install_custom_skill_directory', { directory: customSkillSource.path })
        : await desktopInvoke('install_custom_skill_archive', { archive: customSkillSource.bytes })
      if (typeof value !== 'object' || value === null
        || typeof (value as Partial<CustomSkillState>).slug !== 'string'
        || typeof (value as Partial<CustomSkillState>).name !== 'string'
        || typeof (value as Partial<CustomSkillState>).description !== 'string') {
        throw new Error('桌面端返回的个人技能信息无效。')
      }
      installed = value as CustomSkillState
    } catch (error) {
      setInstallMessage({ kind: 'error', text: marketplaceInstallErrorMessage(error) })
      setInstalling(null)
      return
    }
    try {
      if (typeof installed.body !== 'string' || !Array.isArray(installed.files) || submitPersonalSkill === undefined) throw new Error('桌面端暂不支持个人技能上传，请更新后重试。')
      await submitPersonalSkill({
        slug: installed.slug,
        displayName: name,
        category: newSkill.category,
        icon: newSkill.icon,
        description: newSkill.summary.trim() || installed.description,
        visibility: newSkill.visibility,
        body: installed.body,
        files: installed.files,
      })
      if (loadPersonalSkills !== undefined) void loadPersonalSkills().then(setPersonalSkills).catch(() => {})
    } catch (error) {
      setInstallMessage({ kind: 'error', text: `技能已保存在本机，但上传失败：${marketplaceInstallErrorMessage(error)}` })
      setInstalling(null)
      return
    }
    setInstalling(null)
    const slug = installed.slug
    const id = `local-${slug}`
    const skill: Skill = {
      id,
      slug,
      name,
      category: newSkill.category,
      tags: ['本地', '个人'],
      summary: newSkill.summary.trim() || '本地添加的自定义技能。',
      description: newSkill.summary.trim() || '此技能已安装到当前用户技能目录，新建对话后即可被智能体发现。',
      installs: '0',
      accent: '#2563eb',
      icon: newSkill.icon,
      version: '1.0.0',
      author: '当前用户',
      source: 'personal',
      installable: true,
      marketplacePublished: false,
      reviewStatus: newSkill.visibility === 'public' ? 'pending' : 'none',
    }
    const next = [skill, ...customSkills.filter(item => item.id !== id)]
    setCustomSkills(next)
    setDiscoveredCustomStates(previous => [installed, ...previous.filter(item => item.slug !== slug)])
    localStorage.setItem('dsh.marketplace.custom-skills', JSON.stringify(next))
    setInstallStates(previous => new Map(previous).set(id, { id, slug, version: '1.0.0', installedVersion: '1.0.0', state: 'installed' }))
    setAdding(false)
    setNewSkill({ name: '', summary: '', category: categories[1] ?? '', icon: 'preset:assistant', visibility: 'private' })
    setCustomSkillSource(null)
    setSelectedSkill(skill)
    setView('detail')
    setInstallMessage({ kind: 'success', text: newSkill.visibility === 'public'
      ? '技能已安装并提交审核，审核通过后将进入技能市场。'
      : '个人技能已保存并安装，仅自己可见。' })
  }

  const openDetail = (skill: Skill) => {
    setSelectedSkill(skill)
    setView('detail')
  }

  return (
    <div className="dsh-skill-market-overlay" role="dialog" aria-modal="true" aria-label={L.title}>
      <div className="dsh-skill-market-panel">
        {view === 'list' && (
          <header className="dsh-skill-market-header">
            <div className="dsh-skill-market-heading">
              <span className="dsh-skill-kicker">WANWEI Buddy</span>
              <h1>{SECTION_COPY[section].title}</h1>
              <p>{SECTION_COPY[section].subtitle}</p>
            </div>
            <button type="button" className="dsh-skill-close" aria-label={L.close} onClick={closeMarket}>
              <ArrowLeftIcon />
            </button>
          </header>
        )}

        {view === 'detail' && selectedSkill ? (
          <SkillDetail
            skill={selectedSkill}
            onBack={() => { setView('list') }}
            installState={resolveInstallState(selectedSkill)}
            installing={installing === selectedSkill.id}
            showReview={libraryView === 'uploads'}
            onToggleInstall={() => void toggleInstall(selectedSkill)}
          />
        ) : (
          <>
            {section === 'experts' && <ExpertMarket />}
            {section === 'connectors' && <Connectors />}
            {section === 'automations' && <Automations />}
            {section === 'skills' && <>
              <div className="dsh-skill-toolbar">
                <div className="dsh-skill-search-row">
                  <input
                    value={query}
                    onChange={(event) => { setQuery(event.target.value) }}
                    placeholder={L.search}
                  />
                  <div className="dsh-skill-search-actions">
                    <button
                      type="button"
                      className={libraryView === 'installed' ? 'active' : ''}
                      onClick={() => { setLibraryView(current => current === 'installed' ? 'market' : 'installed'); setQuery('') }}
                    >
                      {L.myInstalled}
                    </button>
                    <button
                      type="button"
                      className={libraryView === 'uploads' ? 'active' : ''}
                      onClick={() => {
                        setLibraryView(current => current === 'uploads' ? 'market' : 'uploads')
                        setQuery('')
                        if (loadPersonalSkills !== undefined) {
                          void loadPersonalSkills().then(setPersonalSkills).catch(() => setPersonalSkills([]))
                        }
                      }}
                    >
                      <span>{L.myUploads}</span>
                      {uploadAttentionCount > 0 && <span className="dsh-skill-count-badge attention">{formatNavigationCount(uploadAttentionCount)}</span>}
                    </button>
                    <button type="button" className="primary" onClick={() => {
                      setAdding(true)
                      if (loadRemoteCategories !== undefined) {
                        void loadRemoteCategories().then(setRemoteCategories).catch(() => setRemoteCategories(null))
                      }
                    }}>{L.addSkill}</button>
                  </div>
                </div>
              </div>

              {libraryView === 'installed' ? (
                <div className="dsh-skill-installed-heading">
                  <div><h2>我的安装</h2><p>当前电脑已安装的技能，包括个人技能和从技能市场添加的技能。</p></div>
                  <button type="button" className="dsh-skill-browse-market" onClick={() => { setLibraryView('market') }}>
                    浏览技能市场 <span aria-hidden="true">→</span>
                  </button>
                </div>
              ) : libraryView === 'uploads' ? (
                <div className="dsh-skill-upload-management">
                  <div className="dsh-skill-installed-heading">
                    <div><h2>我的上传</h2><p>管理已公开、私人保存和提交审核的个人技能。</p></div>
                    <button type="button" className="dsh-skill-browse-market" onClick={() => { setLibraryView('market') }}>
                      浏览技能市场 <span aria-hidden="true">→</span>
                    </button>
                  </div>
                  <div className="dsh-skill-upload-navigation">
                    <div className="dsh-skill-sub-tabs" aria-label="我的上传分类">
                      {([
                        ['public', '公开技能'],
                        ['private', '私人技能'],
                        ['reviews', '审核记录'],
                      ] as const).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          className={uploadView === id ? 'active' : ''}
                          onClick={() => { setUploadView(id) }}
                        >
                          <span>{label}</span>
                          {id === 'reviews' && uploadAttentionCount > 0 && (
                            <span className="dsh-skill-count-badge attention">{formatNavigationCount(uploadAttentionCount)}</span>
                          )}
                        </button>
                      ))}
                    </div>
                    {uploadView === 'reviews' && (
                      <div className="dsh-skill-categories dsh-skill-review-filters" aria-label="审核状态">
                        {([
                          ['all', '全部'],
                          ['pending', '审核中'],
                          ['rejected', '未通过'],
                          ['approved', '已通过'],
                        ] as const).map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            className={reviewFilter === id ? 'active' : ''}
                            onClick={() => { setReviewFilter(id) }}
                          >
                            <span>{label}</span>
                            <span className={`dsh-skill-count-badge ${id}`}>{formatNavigationCount(reviewCounts[id])}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : featuredSkills.length > 0 && (
                <div className="dsh-skill-featured-section">
                  <div className="dsh-skill-section-header">
                    <h2>{L.featured}</h2>
                    <button
                      type="button"
                      className="dsh-skill-refresh"
                      onClick={() => { setFeaturedOffset(Math.floor(Math.random() * 10_000)) }}
                    >
                      <RefreshIcon /> {L.refresh}
                    </button>
                  </div>
                  <div className="dsh-skill-featured-grid">
                    {featuredSkills.map(skill => (
                      <article
                        key={skill.id}
                        className="dsh-skill-featured-card"
                        onClick={() => { openDetail(skill) }}
                      >
                        <div className="dsh-skill-featured-icon" style={{ background: skill.accent + '1f', color: skill.accent }}>
                          <SkillVisual skill={skill} />
                        </div>
                        <div className="dsh-skill-featured-body">
                          <h3>{skill.name}</h3>
                          <p>{skill.summary}</p>
                        </div>
                        <button
                          type="button"
                          className={isInstalled(skill) ? 'installed' : ''}
                          onClick={(e) => { e.stopPropagation(); void toggleInstall(skill) }}
                          disabled={installing === skill.id || skill.installable !== true || resolveInstallState(skill) === 'conflict'}
                          title={skill.installable === true ? undefined : '该技能暂未开放安装'}
                        >
                          {resolveInstallState(skill) === 'updateAvailable' ? '更新' : isInstalled(skill) ? <CheckIcon /> : <PlusIcon />}
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              {libraryView === 'market' && (
                <section className="dsh-skill-all-section">
                  <div className="dsh-skill-section-header">
                    <h2>{L.allSkills}</h2>
                  </div>
                  <div className="dsh-skill-categories">
                    {categories.map(item => (
                      <button
                        key={item}
                        type="button"
                        className={item === category ? 'active' : ''}
                        onClick={() => {
                          setCategory(item)
                          if (loadRemoteSkills !== undefined) {
                            void loadRemoteSkills().then(setRemoteSkills).catch(() => { setRemoteSkills(null) })
                          }
                          if (loadRemoteCategories !== undefined) {
                            void loadRemoteCategories().then(setRemoteCategories).catch(() => { setRemoteCategories(null) })
                          }
                        }}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {libraryView === 'uploads' && uploadView === 'reviews' ? (
                <div className="dsh-skill-review-list">
                  <div className="dsh-skill-review-list-header" aria-hidden="true">
                    <span>技能</span>
                    <span>提交版本</span>
                    <span>提交时间</span>
                    <span>状态</span>
                    <span>审核意见</span>
                    <span>操作</span>
                  </div>
                  {visible.map(skill => (
                    <article key={skill.id} className="dsh-skill-review-row">
                      <div className="dsh-skill-review-skill">
                        <div className="dsh-skill-card-icon" style={{ background: skill.accent + '1f', color: skill.accent }}>
                          <SkillVisual skill={skill} />
                        </div>
                        <div className="dsh-skill-review-skill-copy">
                          <strong>{skill.name}</strong>
                          <div>
                            <span>{skill.category}</span>
                          </div>
                        </div>
                      </div>
                      <div className="dsh-skill-review-version">
                        <strong>v{skill.version}</strong>
                        {skill.publishedVersion && <span>当前公开版本 v{skill.publishedVersion}</span>}
                      </div>
                      <time dateTime={typeof skill.submittedAt === 'string' ? skill.submittedAt : undefined}>
                        {formatReviewTime(skill.submittedAt)}
                      </time>
                      <span className={`dsh-skill-review-status ${skill.reviewStatus ?? 'none'}`}>
                        {reviewStatusLabel(skill.reviewStatus)}
                      </span>
                      <span
                        className={`dsh-skill-review-opinion${skill.reviewStatus === 'rejected' ? ' rejected' : ''}`}
                        title={skill.reviewStatus === 'rejected' ? skill.reviewReason : undefined}
                      >
                        {skill.reviewStatus === 'rejected' && skill.reviewReason ? skill.reviewReason : '—'}
                      </span>
                      <button
                        type="button"
                        className="dsh-skill-review-view"
                        onClick={() => { openDetail(skill) }}
                      >
                        查看
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="dsh-skill-grid">
                  {visible.map(skill => (
                    <article
                      key={skill.id}
                      className="dsh-skill-card"
                      onClick={() => { openDetail(skill) }}
                    >
                      <div className="dsh-skill-card-icon" style={{ background: skill.accent + '1f', color: skill.accent }}>
                        <SkillVisual skill={skill} />
                      </div>
                      <div className="dsh-skill-card-body">
                        <div className="dsh-skill-card-meta">
                          <span
                            className="dsh-skill-card-category"
                            style={{ background: skill.accent + '14', color: skill.accent }}
                          >
                            {skill.category}
                          </span>
                          <span className={`dsh-skill-source ${skill.source === 'personal' ? 'personal' : 'official'}`}>
                            {skill.source === 'personal' ? '个人' : '官方'}
                          </span>
                          {libraryView === 'uploads' && skill.reviewStatus !== undefined && skill.reviewStatus !== 'none' && (
                            <span className={`dsh-skill-review-status ${skill.reviewStatus}`}>
                              {reviewStatusLabel(skill.reviewStatus)}
                            </span>
                          )}
                          {hasVerifiedInstallCount(skill) && <small><DownloadIcon />{skill.installs}</small>}
                        </div>
                        <h2>{skill.name}</h2>
                        <p>{skill.summary}</p>
                        {libraryView === 'installed' && (
                          <button
                            type="button"
                            className={resolveInstallState(skill) === 'updateAvailable'
                              ? 'dsh-skill-card-install-action update'
                              : 'dsh-skill-card-install-action uninstall'}
                            onClick={(event) => { event.stopPropagation(); void toggleInstall(skill) }}
                            disabled={installing === skill.id}
                          >
                            {resolveInstallState(skill) === 'updateAvailable' ? '更新' : '卸载'}
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {visible.length === 0 && (
                <div className="dsh-skill-empty">
                  <div className="dsh-skill-empty-icon"><CategoryGlyph category={category} size={24} /></div>
                  <span>{libraryView === 'installed'
                    ? '暂未安装技能'
                    : libraryView === 'uploads'
                      ? uploadView === 'public'
                        ? '暂无审核通过的公开技能'
                        : uploadView === 'private'
                          ? '暂无私人技能'
                          : '暂无符合条件的审核记录'
                      : L.empty}</span>
                </div>
              )}
            </>}
          </>
        )}
        {installMessage !== null && (
          <Toast text={installMessage.text} tone={installMessage.kind} onDone={() => { setInstallMessage(null) }} />
        )}
        {adding && (
          <div className="dsh-skill-add-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAdding(false) }}>
            <form className="dsh-skill-add-dialog" onSubmit={(event) => { event.preventDefault(); void createSkill() }}>
              <div className="dsh-skill-add-header">
                <h2>{L.createSkill}</h2>
                <button type="button" onClick={() => { setAdding(false) }} aria-label="关闭">×</button>
              </div>
              <label>中文显示名称<input autoFocus value={newSkill.name} onChange={(event) => { setNewSkill({ ...newSkill, name: event.target.value }) }} placeholder="例如：会议纪要整理" /></label>
              <label className="dsh-skill-add-field">
                <span className="dsh-skill-add-field-label">分类</span>
                <SkillCategorySelect
                  options={categories.slice(1)}
                  value={newSkill.category}
                  onChange={(value) => { setNewSkill(current => ({ ...current, category: value })) }}
                />
              </label>
              <label>用途说明<textarea value={newSkill.summary} onChange={(event) => { setNewSkill({ ...newSkill, summary: event.target.value }) }} placeholder="说明这个技能何时使用、能完成什么任务" /></label>
              <label>
                技能图标
                <span className="dsh-skill-add-icon-options" role="radiogroup" aria-label="技能图标">
                  {DEFAULT_SKILL_ICONS.map((item) => {
                    const selected = newSkill.icon === item.value
                    return <button key={item.value} type="button" role="radio" aria-checked={selected} title={item.label} aria-label={item.label} className={selected ? 'active' : ''} onClick={() => { setNewSkill(current => ({ ...current, icon: item.value })) }}><DefaultSkillIcon icon={item.value} size={30} /></button>
                  })}
                </span>
                <small className="dsh-skill-add-icon-hint">选择一个通用技能图标，用于个人技能和审核通过后的技能市场展示。</small>
              </label>
              <fieldset className="dsh-skill-add-visibility">
                <legend>可见范围</legend>
                <div>
                  <button type="button" className={newSkill.visibility === 'private' ? 'active' : ''} onClick={() => { setNewSkill({ ...newSkill, visibility: 'private' }) }}><strong>私人</strong><span>仅自己使用；管理员可查看和下载</span></button>
                  <button type="button" className={newSkill.visibility === 'public' ? 'active' : ''} onClick={() => { setNewSkill({ ...newSkill, visibility: 'public' }) }}><strong>公开</strong><span>提交管理员审核</span></button>
                </div>
              </fieldset>
              <div className="dsh-skill-add-source-field">
                <span className="dsh-skill-add-source-title">个人技能来源</span>
                <span className="dsh-skill-add-source-actions">
                  <button type="button" className="dsh-skill-add-directory" onClick={() => { void selectCustomSkillDirectory() }} disabled={installing !== null}>选择目录</button>
                  <label className={`dsh-skill-add-directory${installing !== null ? ' disabled' : ''}`}>
                    选择 ZIP
                    <input
                      type="file"
                      accept=".zip,application/zip"
                      disabled={installing !== null}
                      hidden
                      onChange={(event) => {
                        void selectCustomSkillArchive(event.target.files?.[0])
                        event.target.value = ''
                      }}
                    />
                  </label>
                </span>
                {customSkillSource !== null && (
                  <div
                    className="dsh-skill-add-selected"
                    title={customSkillSource.kind === 'directory' ? customSkillSource.path : customSkillSource.name}
                  >
                    <span>已选择</span>
                    <strong>{customSkillSource.kind === 'directory' ? customSkillSource.path : customSkillSource.name}</strong>
                  </div>
                )}
              </div>
              <small className="dsh-skill-add-hint">请选择包含 SKILL.md 的完整目录或 ZIP。文件会安装到本机并安全上传；公开技能审核通过前不会出现在技能市场，更新已公开技能也需要再次审核。</small>
              <footer>
                <button type="button" onClick={() => { setAdding(false) }}>取消</button>
                <button
                  type="submit"
                  disabled={newSkill.name.trim() === '' || customSkillSource === null || installing !== null
                    || !categories.slice(1).includes(newSkill.category)}
                >
                  {newSkill.visibility === 'public' ? '提交审核并安装' : '保存并安装'}
                </button>
              </footer>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

function SkillMarketplaceAction({ wide, section = 'skills' }: ActionProps & { section?: MarketplaceSection }) {
  const labels: Record<MarketplaceSection, string> = {
    skills: L.action,
    experts: L.experts,
    connectors: L.connectors,
    automations: L.automations,
  }
  // Clicking the entry again collapses its panel: the button reflects the
  // controller's open state so the toggle reads as selected while expanded.
  const open = useSyncExternalStore(
    marketplaceControllers[section].subscribe,
    () => marketplaceControllers[section].isOpen(),
  )
  const [attentionCount, setAttentionCount] = useState<number | null>(null)
  useEffect(() => {
    if (section !== 'skills' || loadPersonalSkills === undefined) return
    let active = true
    void loadPersonalSkills().then((skills) => {
      if (!active) return
      const counts = countPersonalSkillReviews(skills.map(skill => ({
        visibility: skill.visibility,
        reviewStatus: parseReviewStatus(skill.review_status),
      })))
      setAttentionCount(counts.rejected)
    }).catch(() => {})
    return () => { active = false }
  }, [open, section])
  return (
    <button
      type="button"
      className={`dsh-skill-market-action${wide ? '' : ' rail'}${open ? ' active' : ''}`}
      aria-label={labels[section]}
      aria-expanded={open}
      onClick={() => { marketplaceControllers[section].toggle() }}
    >
      <MarketplaceSectionIcon section={section} size={wide ? 16 : 18} />
      {wide && <span>{labels[section]}</span>}
      {section === 'skills' && attentionCount !== null && attentionCount > 0 && (
        <span className="dsh-skill-sidebar-count" aria-label={`${attentionCount} 条未通过审核记录`}>
          {formatNavigationCount(attentionCount)}
        </span>
      )}
    </button>
  )
}

export const inject = ['slots', 'connection', 'workspaces']
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const workspaces = ctx.get('workspaces') as unknown as IWorkspaces
  loadRemoteSkills = async () => {
    const raw = rpcValue(await connection.rpc.call('/desktop-auth', 'skill-list', {})) as { items?: unknown }
    return Array.isArray(raw?.items) ? raw.items.filter((item): item is RemoteSkill => typeof item === 'object' && item !== null) : []
  }
  loadRemoteCategories = async () => {
    const raw = rpcValue(await connection.rpc.call('/desktop-auth', 'skill-categories', {})) as { items?: unknown }
    return Array.isArray(raw?.items) ? raw.items.filter((item): item is RemoteSkillCategory => typeof item === 'object' && item !== null) : []
  }
  loadRemoteSkillBundle = async (id: number) => rpcValue(await connection.rpc.call('/desktop-auth', 'skill-bundle', { id }))
  recordRemoteSkillInstall = async (id: number) => rpcValue(await connection.rpc.call('/desktop-auth', 'skill-download', { id }))
  submitPersonalSkill = async (payload: unknown) => rpcValue(await connection.rpc.call('/desktop-auth', 'personal-skill-submit', payload))
  loadPersonalSkills = async () => {
    const raw = rpcValue(await connection.rpc.call('/desktop-auth', 'personal-skill-list', {})) as { items?: unknown }
    return Array.isArray(raw.items) ? raw.items as RemotePersonalSkill[] : []
  }
  const marketplaceUrl = (process.env.DSH_CLIENT_SKILL_MARKETPLACE_URL ?? 'https://skills.zjugis.com/').trim()
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      { name: 'sidebar.footer.action', id: 'skill-automations', order: 10, inject: () => ({ section: 'automations' as const }) },
      SkillMarketplaceAction,
    ),
  )
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      { name: 'sidebar.footer.action', id: 'skill-connectors', order: 20, inject: () => ({ section: 'connectors' as const }) },
      SkillMarketplaceAction,
    ),
  )
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      { name: 'sidebar.footer.action', id: 'skill-experts', order: 30, inject: () => ({ section: 'experts' as const }) },
      SkillMarketplaceAction,
    ),
  )
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      { name: 'sidebar.footer.action', id: 'skill-marketplace', order: 40 },
      SkillMarketplaceAction,
    ),
  )
  for (const [index, section] of (['skills', 'experts', 'connectors', 'automations'] as const).entries()) {
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: `skill-marketplace-${section}`, order: 100 + index, inject: () => ({ marketplaceUrl, section, chooseDirectory: () => workspaces.pickDirectory() }) },
        SkillMarketplace,
      ),
    )
  }
}
