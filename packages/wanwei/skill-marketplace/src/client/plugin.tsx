import { productText } from './locales/product.ts'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { NetworkController, NetworkState } from '@deepseek-ai/dsh-wanwei-oneapi-auth/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ConnectionHandle, RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import type { PropsRuntime, HostObservable, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Select } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import {
  browseMarketplaceCatalog,
  buildMarketplaceCatalog,
  buildMarketplaceCategories,
  filterPersonalSkillUploads,
  publishedSkillCategories,
  pagePlatformCatalog,
} from './catalog.ts'
import type { PersonalSkillReviewFilter, PersonalSkillUploadView } from './catalog.ts'
import { marketplaceInstallAction } from './install-action.ts'
import type { MarketplaceInstallState } from './install-action.ts'
import { markReviewsSeen, recordReviewList, reviewAttentionSnapshot, subscribeReviewAttention } from './review-attention.ts'
import { registerNativeSkillCatalogBridge } from './skill-catalog-bridge.ts'
import { rememberSkillDisplayNames, skillDisplayName, skillSessionPreparation, startSkillUse } from './skill-use.ts'
import { Toast, createPanelController, usePanelNavigation, type PanelController, type WanweiNotice } from '@deepseek-ai/dsh-wanwei-feature-panels/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import './marketplace.css'
import { SkillHubSection } from './SkillHubSection.tsx'
import { CatalogToolbar, CatalogDownloadIcon, CatalogBackIcon as ArrowLeftIcon } from './CatalogToolbar.tsx'

type SkillParam = { name: string; type: string; required: boolean; description: string; defaultValue?: string }
type Skill = {
  requiresInternet?: boolean
  id: string
  name: string
  category: string
  categories?: readonly string[]
  tags: readonly string[]
  summary: string
  description: string
  usageExample?: string
  installs: string
  updatedAt?: string | number
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

type RemoteSkill = {
  requires_internet?: unknown
  id?: unknown
  name?: unknown
  display_name?: unknown
  icon?: unknown
  category?: unknown
  description?: unknown
  scenario?: unknown
  usage_example?: unknown
  downloads?: unknown
  updated_at?: unknown
  version?: unknown
  submitter?: unknown
  tags?: unknown
  source?: unknown
  categories?: unknown
}
type RemoteSkillCategory = { name?: unknown; code?: unknown }
type RemoteSkillBundle = { assets?: unknown; sha256?: unknown; download_event_id?: unknown }
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
  if (status === 'pending') return productText('审核中')
  if (status === 'rejected') return productText('未通过')
  if (status === 'approved') return productText('已通过')
  return productText('未提交')
}

type MarketplaceServices = {
  skillhubRequest: (operation: string, payload: unknown) => Promise<unknown>
  loadRemoteSkills?: () => Promise<RemoteSkill[]>
  loadReferencedSkill?: (slug: string) => Promise<Skill | undefined>
  startSkillConversation?: (slug: string, displayName: string) => void
  loadRemoteCategories?: () => Promise<RemoteSkillCategory[]>
  loadRemoteSkillBundle?: (id: number) => Promise<unknown>
  recordRemoteSkillInstall?: (id: number, eventId?: string) => Promise<unknown>
  submitPersonalSkill?: (payload: unknown) => Promise<unknown>
  loadPersonalSkills?: () => Promise<RemotePersonalSkill[]>
}

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

type DesktopBridge = { core?: { invoke?: (command: string, argumentsValue?: unknown) => Promise<unknown> } }
type DesktopInternals = { invoke?: (command: string, argumentsValue?: unknown) => Promise<unknown> }

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
  return productText('技能安装失败')
}

function hasVerifiedInstallCount(skill: Skill): boolean {
  return skill.remoteId !== undefined
}

function serverSkillFiles(bundle: unknown): { files: Array<{ path: string; content: number[] }>; sha256?: string; eventId?: string } {
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
  const candidateEventId = (bundle as RemoteSkillBundle).download_event_id
  return { files: decodedFiles, ...(sha256 === undefined ? {} : { sha256 }),
    ...(typeof candidateEventId === 'string' ? { eventId: candidateEventId } : {}) }
}

const L = {
  title: productText('技能市场'),
  close: '关闭技能市场',
  subtitle: productText('发现可复用的工作流和智能助手'),
  search: '搜索技能',
  myInstalled: '我的安装',
  myUploads: '我的上传',
  addSkill: '添加技能',
  all: '全部',
  featured: '推荐技能',
  allSkills: '平台技能',
  refresh: '换一批',
  installed: '已安装',
  install: '安装',
  count: '次安装',
  empty: productText('没有匹配的技能'),
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
  { value: 'preset:checklist', label: productText('文档整理'), src: '/skill-icons/checklist.png' },
  { value: 'preset:batch-documents', label: productText('批量文档'), src: '/skill-icons/batch-documents.png' },
  { value: 'preset:assistant', label: productText('智能助手'), src: '/skill-icons/assistant.png' },
  { value: 'preset:document-settings', label: productText('文档配置'), src: '/skill-icons/document-settings.png' },
  { value: 'preset:workflow', label: productText('工作流程'), src: '/skill-icons/workflow.png' },
  { value: 'preset:analytics', label: productText('数据分析'), src: '/skill-icons/analytics.png' },
  { value: 'preset:conversation', label: productText('沟通协作'), src: '/skill-icons/conversation.png' },
  { value: 'preset:integration', label: productText('工具集成'), src: '/skill-icons/integration.png' },
  { value: 'preset:cloud-upload', label: productText('云端上传'), src: '/skill-icons/cloud-upload.png' },
  { value: 'preset:toolbox', label: productText('工具箱'), src: '/skill-icons/toolbox.png' },
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
  return <span className="dsh-skill-text-icon" style={{ fontSize: Math.max(13, size - 2) }}>{skill.icon || productText('技')}</span>
}

const DownloadIcon = CatalogDownloadIcon

/** Visual identity for each marketplace capability in the sidebar and cards. */

type NetworkInjected = { catalogAccess: NetworkController['catalogAccess']; controller: PanelController; services: MarketplaceServices; hooks: { network: HostObservable<NetworkState> } }
type OverlayProps = PropsRuntime<'shell.overlay'> & InjectFace<NetworkInjected> & {
  marketplaceUrl: string
  chooseDirectory: () => Promise<string | null>
}
type CustomSkillSource =
  | { kind: 'directory'; path: string }
  | { kind: 'archive'; name: string; bytes: number[] }
type ActionProps = PropsRuntime<'sidebar.footer.action'> & SidebarFooterActionOwnerProps & InjectFace<NetworkInjected>

function SkillDetail({ skill, onBack, installState, installing, onToggleInstall, onUse, onOpenDirectory, showReview = false }: {
  skill: Skill
  onBack: () => void
  installState: MarketplaceInstallState
  installing: boolean
  onToggleInstall: () => void
  onUse: () => void
  onOpenDirectory: () => void
  showReview?: boolean
}) {
  const installed = installState === 'installed' || installState === 'updateAvailable'
  const installLabel = skill.installable !== true
    ? productText('暂未开放安装')
    : installState === 'updateAvailable'
      ? productText('更新技能')
      : installState === 'conflict'
        ? productText('存在同名本地技能')
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
            <span className={`dsh-skill-source ${skill.source === 'personal' ? 'personal' : 'official'}`}>{skill.source === 'personal' ? productText('个人') : productText('官方')}</span>
            {showReview && skill.reviewStatus !== undefined && skill.reviewStatus !== 'none' && (
              <span className={`dsh-skill-review-status ${skill.reviewStatus}`}>{reviewStatusLabel(skill.reviewStatus)}</span>
            )}
            <span>{L.version}: {skill.version}</span>
            <span>{L.author}: {skill.author}</span>
            {hasVerifiedInstallCount(skill) && <span>{skill.installs} {L.count}</span>}
          </div>
        </div>
        <div className="dsh-skill-detail-actions">
          {installed && <button type="button" className="dsh-skill-detail-use" disabled={installing} onClick={onOpenDirectory}>{productText('打开目录')}</button>}
          {installed && <button type="button" className="dsh-skill-detail-use" onClick={onUse}>{productText('使用技能')}</button>}
          <button
            type="button"
            className={`dsh-skill-detail-install${installed ? ' installed' : ''}`}
            onClick={onToggleInstall}
            disabled={installing || skill.installable !== true || installState === 'conflict'}
          >
            {installing ? productText('处理中…') : installLabel}
          </button>
        </div>
      </div>
      {showReview && skill.reviewStatus === 'rejected' && skill.reviewReason && (
        <div className="dsh-skill-review-notice">{productText('审核意见：')}{skill.reviewReason}</div>
      )}
      <div className="dsh-skill-detail-body">
        {skill.params && skill.params.length > 0 && <div className="dsh-skill-detail-section">
          <h3>{L.params}</h3>
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
                    {productText('默认值: ')}{param.defaultValue}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>}
        <div className="dsh-skill-detail-section">
          <h3>{productText('详细描述')}</h3>
          <p>{skill.description}</p>
        </div>
        {skill.usageExample?.trim() && <div className="dsh-skill-detail-section dsh-skill-usage-examples">
          <h3>{productText('使用示例')}</h3>
          <p>{skill.usageExample}</p>
        </div>}
      </div>
    </div>
  )
}

function SkillCategorySelect({
  options,
  value,
  onChange,
}: {
  options: readonly string[]
  value: string
  onChange: (value: string) => void
}) {
  return <Select label={productText('技能分类')} emptyLabel={productText('暂无可用分类')} value={value}
    options={options.map(option => ({ value: option, label: option }))}
    onChange={onChange} className="dsh-skill-add-select-trigger" />
}

function SkillMarketplace({ controller, services, chooseDirectory, useNetwork, catalogAccess }: OverlayProps) {
  const network = useNetwork(value => value)
  const { skillhubRequest, loadRemoteSkills, startSkillConversation, loadRemoteCategories,
    loadRemoteSkillBundle, recordRemoteSkillInstall, submitPersonalSkill, loadPersonalSkills } = services
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(L.all)
  const [platformKeyword, setPlatformKeyword] = useState('')
  const [platformQuery, setPlatformQuery] = useState('')
  const [platformSort, setPlatformSort] = useState('recommended')
  const [platformPage, setPlatformPage] = useState(1)
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)
  const [requestedSkillRef, setRequestedSkillRef] = useState<string | null>(null)
  const [libraryView, setLibraryView] = useState<'market' | 'installed' | 'uploads'>('market')
  const [uploadView, setUploadView] = useState<PersonalSkillUploadView>('public')
  const [reviewFilter, setReviewFilter] = useState<PersonalSkillReviewFilter>('all')
  const [installing, setInstalling] = useState<string | null>(null)
  const [installMessage, setInstallMessage] = useState<WanweiNotice | null>(null)
  const [customSkills, setCustomSkills] = useState<Skill[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('dsh.marketplace.custom-skills') ?? '[]') as Skill[]
    } catch {
      return []
    }
  })
  const [discoveredCustomSkills, setDiscoveredCustomSkills] = useState<Skill[]>([])
  const [adding, setAdding] = useState(false)
  const [newSkill, setNewSkill] = useState({ name: '', summary: '', category: '通用', icon: 'preset:assistant', visibility: 'private' as 'private' | 'public' })
  const [customSkillSource, setCustomSkillSource] = useState<CustomSkillSource | null>(null)
  const [remoteSkills, setRemoteSkills] = useState<RemoteSkill[] | null>(null)
  const [remoteSkillsLoaded, setRemoteSkillsLoaded] = useState(false)
  const [remoteCategories, setRemoteCategories] = useState<RemoteSkillCategory[] | null>(null)
  const [personalSkills, setPersonalSkills] = useState<RemotePersonalSkill[]>([])
  const [personalSkillsLoaded, setPersonalSkillsLoaded] = useState(false)
  const reviewAttention = useSyncExternalStore(subscribeReviewAttention, reviewAttentionSnapshot)

  const [installStates, setInstallStates] = useState<Map<string, MarketplaceSkillState>>(new Map())
  const installRefreshGeneration = useRef(0)
  const refreshInstallStates = async () => {
    const generation = ++installRefreshGeneration.current
    try {
      const [value, customValue] = await Promise.all([
        desktopInvoke('list_marketplace_skills', {}),
        desktopInvoke('list_custom_skills', {}),
      ])
      if (generation !== installRefreshGeneration.current) return
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
      const knownCustomSkills = new Map(customSkills.map(skill => [skillSlug(skill), {
        ...skill,
        tags: [...new Set([...skill.tags, '本地', '个人'])],
        source: 'personal' as const,
        marketplacePublished: false,
      }]))
      const discovered = customEntries.map((item): Skill => knownCustomSkills.get(item.slug) ?? {
        id: `local-${item.slug}`,
        slug: item.slug,
        name: item.name,
        category: '本地技能',
        tags: ['本地', '个人'],
        summary: item.description,
        description: item.description,
        installs: '0',
        accent: '#2563eb',
        icon: '自',
        version: '1.0.0',
        author: '当前用户',
        source: 'personal',
        installable: true,
        marketplacePublished: false,
      })
      setDiscoveredCustomSkills(discovered)
      const customStates = discovered
        .map(skill => [skill.id, { id: skill.id, slug: skillSlug(skill), version: skill.version, installedVersion: skill.version, state: 'installed' as const }] as const)
      setInstallStates(new Map([
        ...customStates,
        ...states.map(state => [state.id, state] as const),
      ]))
    } catch {
      // Browser previews have no native bridge; installation remains unavailable there.
    }
  }
  const refreshInstallStatesRef = useRef(refreshInstallStates)
  refreshInstallStatesRef.current = refreshInstallStates
  useEffect(() => {
    if (!open) return
    const refresh = () => { void refreshInstallStatesRef.current() }
    window.addEventListener('dsh:skills-changed', refresh)
    return () => { window.removeEventListener('dsh:skills-changed', refresh) }
  }, [open])

  useEffect(() => controller.subscribe((next) => {
    setOpen(next.open)
    if (next.open) {
      setLibraryView('market')
      setView('list')
      setSelectedSkill(null)
      setQuery('')
      setCategory(L.all)
      setPlatformSort('recommended')
      setPlatformPage(1)
      void refreshInstallStates()
      if (loadRemoteSkills !== undefined) {
        setRemoteSkillsLoaded(false)
        void loadRemoteSkills().then(setRemoteSkills).catch(() => { setRemoteSkills(null) })
          .finally(() => { setRemoteSkillsLoaded(true) })
      } else {
        setRemoteSkillsLoaded(true)
      }
      if (loadRemoteCategories !== undefined) {
        void loadRemoteCategories().then(setRemoteCategories).catch(() => { setRemoteCategories(null) })
      }
      if (loadPersonalSkills !== undefined) {
        void loadPersonalSkills().then((items) => { setPersonalSkills(items); setPersonalSkillsLoaded(true) })
          .catch(() => { setPersonalSkillsLoaded(false) })
      }
    }
    if (!next.open) {
      setRequestedSkillRef(null)
      setView('list')
      setSelectedSkill(null)
    }
  }), [])

  usePanelNavigation(controller, open)

  const refreshPlatformCatalog = async () => {
    setPlatformSort('recommended')
    setPlatformPage(1)
    setRemoteSkillsLoaded(false)
    try {
      const [skills, categories] = await Promise.all([
        loadRemoteSkills?.(), loadRemoteCategories?.(),
      ])
      if (skills !== undefined) setRemoteSkills(skills)
      if (categories !== undefined) setRemoteCategories(categories)
    } catch (error) {
      setInstallMessage({ kind: 'error', text: String(error) })
    } finally {
      setRemoteSkillsLoaded(true)
    }
  }

  const unfilteredSkills = useMemo<Skill[]>(() => {
    const published = remoteSkills?.flatMap((remote): Skill[] => {
      const slug = typeof remote.name === 'string' ? remote.name : ''
      if (slug === '') return []
      const remoteId = typeof remote.id === 'number' || typeof remote.id === 'string' ? String(remote.id) : slug
      const source = remote.source === 'personal' ? 'personal' : 'official'
      const remoteTags = Array.isArray(remote.tags) ? remote.tags.filter((tag): tag is string => typeof tag === 'string') : []
      const relationCategories = publishedSkillCategories(remote.categories)
      const legacyCategory = typeof remote.category === 'string' && remote.category.trim() !== '' ? remote.category.trim() : '通用'
      const categories = relationCategories.length > 0 ? relationCategories : [legacyCategory]
      const updatedAt = parseReviewTime(remote.updated_at)
      return [{
        id: `remote-${remoteId}`,
        requiresInternet: remote.requires_internet !== false,
        ...(typeof remote.id === 'number' ? { remoteId: remote.id } : {}),
        slug,
        name: typeof remote.display_name === 'string' && remote.display_name !== '' ? remote.display_name : slug,
        category: categories[0] ?? legacyCategory,
        categories,
        tags: [...new Set([...remoteTags, source === 'personal' ? '个人' : '官方'])],
        summary: typeof remote.description === 'string' ? remote.description : '',
        description: typeof remote.scenario === 'string' && remote.scenario !== '' ? remote.scenario : (typeof remote.description === 'string' ? remote.description : ''),
        usageExample: typeof remote.usage_example === 'string' ? remote.usage_example : '',
        installs: String(typeof remote.downloads === 'number' ? remote.downloads : 0),
        ...(updatedAt === undefined ? {} : { updatedAt }),
        accent: '#2563eb', icon: typeof remote.icon === 'string' && remote.icon.trim() !== '' ? remote.icon : 'preset:assistant', version: typeof remote.version === 'string' ? remote.version : '1.0.0',
        author: typeof remote.submitter === 'string' ? remote.submitter : '平台管理员',
        source,
        installable: true,
        marketplacePublished: true,
      }]
    }) ?? null
    return buildMarketplaceCatalog(discoveredCustomSkills, published)
  }, [discoveredCustomSkills, remoteSkills])
  const skillAccess = (skill: Skill) => catalogAccess(network, skill.requiresInternet
    ?? unfilteredSkills.find(item => item.marketplacePublished && skillSlug(item) === skillSlug(skill))?.requiresInternet ?? false, 'skill')
  const allSkills = useMemo(() => unfilteredSkills.filter(skill => catalogAccess(network, skill.requiresInternet
    ?? unfilteredSkills.find(item => item.marketplacePublished && skillSlug(item) === skillSlug(skill))?.requiresInternet ?? false, 'skill') !== 'hide'),
  [unfilteredSkills, network, catalogAccess])
  const skillAccessProps = (skill: Skill) => ({
    role: 'button', tabIndex: skillAccess(skill) === 'available' ? 0 : -1,
    'aria-disabled': skillAccess(skill) !== 'available',
    title: skillAccess(skill) !== 'available' ? productText('当前网络环境不可达，请检查您的网络') : undefined,
  })
  useEffect(() => {
    if (selectedSkill !== null && catalogAccess(network, selectedSkill.requiresInternet
      ?? unfilteredSkills.find(item => item.marketplacePublished && skillSlug(item) === skillSlug(selectedSkill))?.requiresInternet ?? false, 'skill') !== 'available') {
      setSelectedSkill(null)
      setView('list')
    }
  }, [network, selectedSkill, unfilteredSkills, catalogAccess])
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
  const unreadReviewStatuses = Object.values(reviewAttention?.unread ?? {})
  useEffect(() => {
    const onReferenceOpen = (event: Event) => {
      const detail: unknown = (event as CustomEvent).detail
      if (typeof detail !== 'object' || detail === null || !('source' in detail) || detail.source !== 'skill'
        || !('ref' in detail) || typeof detail.ref !== 'string') return
      controller.open()
      setRequestedSkillRef(detail.ref.replace(/^\//u, ''))
    }
    window.addEventListener('dsh:reference-open', onReferenceOpen)
    return () => { window.removeEventListener('dsh:reference-open', onReferenceOpen) }
  }, [controller])
  useEffect(() => {
    if (!open || requestedSkillRef === null || !remoteSkillsLoaded) return
    const skill = [...allSkills, ...uploadedSkills].find(item => skillSlug(item) === requestedSkillRef)
    if (skill !== undefined) {
      setSelectedSkill(skill)
      setView('detail')
      setRequestedSkillRef(null)
      return
    }
    let cancelled = false
    void services.loadReferencedSkill?.(requestedSkillRef).then((local) => {
      if (cancelled) return
      if (local === undefined) {
        setInstallMessage({ kind: 'error', text: productText('未找到该技能，请刷新技能列表后重试。') })
        setRequestedSkillRef(null)
        return
      }
      setSelectedSkill(local)
      setView('detail')
      setRequestedSkillRef(null)
    }).catch((error: unknown) => {
      if (!cancelled) setInstallMessage({ kind: 'error', text: String(error) })
    })
    return () => { cancelled = true }
  }, [open, requestedSkillRef, allSkills, uploadedSkills, services, remoteSkillsLoaded])
  const uploadAttentionCount = unreadReviewStatuses.length
  useEffect(() => {
    if (!open || !personalSkillsLoaded || libraryView !== 'uploads' || uploadView !== 'reviews') return
    if (reviewFilter === 'approved' || reviewFilter === 'rejected') markReviewsSeen(reviewFilter)
  }, [open, personalSkillsLoaded, libraryView, uploadView, reviewFilter, personalSkills])
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
  const featuredPool = useMemo(() => browseMarketplaceCatalog(allSkills).filter(skill => skill.source === 'official'), [allSkills])
  const [featuredOffset, setFeaturedOffset] = useState(() => Math.floor(Math.random() * 10_000))
  const featuredSkills = useMemo(() => {
    const pick = (pool: Skill[], count: number) => {
      if (pool.length <= count) return pool
      const start = featuredOffset % pool.length
      const step = Math.max(1, Math.floor(pool.length / count))
      return Array.from({ length: count }, (_, i) => pool[(start + i * step) % pool.length])
        .filter((skill): skill is Skill => skill !== undefined)
    }
    const available = featuredPool.filter(skill => skillAccess(skill) === 'available')
    const disabled = featuredPool.filter(skill => skillAccess(skill) !== 'available')
    const first = pick(available, 3)
    return [...first, ...pick(disabled, 3 - first.length)]
  }, [featuredPool, featuredOffset, network, unfilteredSkills, catalogAccess])

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
    const search = libraryView === 'market' ? platformQuery : query
    if (search.trim() !== '') {
      const q = search.trim().toLowerCase()
      skills = skills.filter(s => `${s.name} ${s.summary} ${s.category}`.toLowerCase().includes(q))
    }
    if (libraryView === 'installed') skills = skills.filter(isInstalled)
    return skills
  }, [allSkills, category, query, platformQuery, libraryView, uploadView, reviewFilter, uploadedSkills, installStates])

  const platform = useMemo(() => pagePlatformCatalog(visible, platformSort, platformPage,
    skill => skillAccess(skill) === 'available' ? 0 : 1), [visible, platformSort, platformPage, network, unfilteredSkills, catalogAccess])
  const displayedSkills = libraryView === 'market' ? platform.items : libraryView === 'installed'
    ? [...visible].sort((a, b) => Number(skillAccess(a) !== 'available') - Number(skillAccess(b) !== 'available')) : visible
  useEffect(() => { setPlatformPage(1) }, [category, platformQuery, platformSort])

  if (!open) return null

  const closeMarket = () => { setOpen(false); controller.close() }

  const toggleInstall = async (skill: Skill) => {
    if (skillAccess(skill) !== 'available') return
    if (installing !== null) return
    if (skill.installable !== true) {
      setInstallMessage({ kind: 'error', text: productText('该技能暂未提供可安装的技能包。') })
      return
    }
    const slug = skillSlug(skill)
    const currentState = resolveInstallState(skill)
    const action = marketplaceInstallAction(currentState)
    setInstallMessage(null)
    setInstalling(skill.id)
    let reportFailure: string | undefined
    try {
      if (skill.tags.includes('本地') && action === 'uninstall') {
        await desktopInvoke('uninstall_custom_skill', { slug })
        const next = customSkills.filter(item => item.id !== skill.id)
        setCustomSkills(next)
        setDiscoveredCustomSkills(previous => previous.filter(item => item.id !== skill.id))
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
        await desktopInvoke('install_marketplace_skill', { slug, files: bundle?.files, sha256: bundle?.sha256, displayName: skill.name })
        if (skill.remoteId !== undefined && recordRemoteSkillInstall !== undefined) {
          try {
            await recordRemoteSkillInstall(skill.remoteId, bundle?.eventId)
            if (loadRemoteSkills !== undefined) setRemoteSkills(await loadRemoteSkills())
          } catch (error) {
            // The completed local installation remains valid when telemetry is unavailable.
            reportFailure = `技能已安装，但下载量同步失败：${marketplaceInstallErrorMessage(error)}`
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
    if (reportFailure !== undefined) {
      setInstallMessage({ kind: 'error', text: reportFailure })
      return
    }
    setInstallMessage(action === 'update'
      ? { kind: 'success', text: productText('更新成功') }
      : action === 'install'
        ? { kind: 'success', text: productText('安装成功') }
        : { kind: 'success', text: productText('卸载成功') })
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
      setInstallMessage({ kind: 'error', text: productText('请选择 ZIP 格式的个人技能包。') })
      return
    }
    if (file.size > 16 * 1024 * 1024) {
      setInstallMessage({ kind: 'error', text: productText('个人技能 ZIP 不能超过 16 MB。') })
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
        ? await desktopInvoke('install_custom_skill_directory', { directory: customSkillSource.path, displayName: name })
        : await desktopInvoke('install_custom_skill_archive', { archive: customSkillSource.bytes, displayName: name })
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
      setInstallMessage({ kind: 'error', text: productText('技能已保存在本机，但上传失败：{0}', [marketplaceInstallErrorMessage(error)]) })
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
      summary: newSkill.summary.trim() || productText('本地添加的自定义技能。'),
      description: newSkill.summary.trim() || productText('此技能已安装到当前用户技能目录，新建对话后即可被智能体发现。'),
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
    setDiscoveredCustomSkills(previous => [skill, ...previous.filter(item => item.id !== id)])
    localStorage.setItem('dsh.marketplace.custom-skills', JSON.stringify(next))
    setInstallStates(previous => new Map(previous).set(id, { id, slug, version: '1.0.0', installedVersion: '1.0.0', state: 'installed' }))
    setAdding(false)
    setNewSkill({ name: '', summary: '', category: categories[1] ?? '通用', icon: 'preset:assistant', visibility: 'private' })
    setCustomSkillSource(null)
    setSelectedSkill(skill)
    setView('detail')
    setInstallMessage({ kind: 'success', text: newSkill.visibility === 'public'
      ? productText('技能已安装并提交审核，审核通过后将进入技能市场。')
      : productText('个人技能已保存并安装，仅自己可见。') })
  }

  const openDetail = (skill: Skill) => {
    if (skillAccess(skill) !== 'available') return
    setSelectedSkill(skill)
    setView('detail')
  }

  return (
    <div className="dsh-skill-market-overlay" role="dialog" aria-modal="true" aria-label={L.title}>
      <div className="dsh-skill-market-panel dsh-skill-market-catalog-panel">
        {view === 'list' && (
          <header className="dsh-skill-market-header">
            <div className="dsh-skill-market-heading">
              <span className="dsh-skill-kicker">{productText('WANWEI Buddy')}</span>
              <h1>{L.title}</h1>
              <p>{L.subtitle}</p>
            </div>
            <button type="button" className="dsh-skill-close" aria-label={L.close} onClick={closeMarket}><ArrowLeftIcon /></button>
            {<div className="dsh-skill-market-header-controls">
              <div className="dsh-skill-search-actions">
                <button type="button" className={libraryView === 'installed' ? 'active' : ''} onClick={() => { setLibraryView(current => current === 'installed' ? 'market' : 'installed'); setQuery('') }}>{L.myInstalled}</button>
                <button type="button" className={libraryView === 'uploads' ? 'active' : ''} onClick={() => {
                  setLibraryView(current => current === 'uploads' ? 'market' : 'uploads'); setQuery('')
                  if (loadPersonalSkills !== undefined) {
                    void loadPersonalSkills().then((items) => {
                      setPersonalSkills(items)
                      setPersonalSkillsLoaded(true)
                    }).catch(() => { setPersonalSkillsLoaded(false) })
                  }
                }}>{L.myUploads}{uploadAttentionCount > 0 && <span className="dsh-skill-unread-count">{uploadAttentionCount > 99 ? '99+' : uploadAttentionCount}</span>}</button>
                <button type="button" className="primary" onClick={() => {
                  setAdding(true)
                  if (loadRemoteCategories !== undefined) {
                    void loadRemoteCategories().then(setRemoteCategories).catch(() => { setRemoteCategories(null) })
                  }
                }}>{L.addSkill}</button>
              </div>
            </div>}
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
            onOpenDirectory={() => { void desktopInvoke('open_skill_directory', { slug: skillSlug(selectedSkill) }).catch((error: unknown) => {
              setInstallMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
            }) }}
            onUse={() => {
              if (skillAccess(selectedSkill) !== 'available') return
              if (startSkillConversation === undefined) {
                setInstallMessage({ kind: 'error', text: productText('对话服务尚未准备好，请稍后重试。') })
                return
              }
              startSkillConversation(skillSlug(selectedSkill), selectedSkill.name)
              closeMarket()
            }}
          />
        ) : (
          <>
            {<>
              {libraryView === 'installed' ? (
                <div className="dsh-skill-installed-heading">
                  <div><h2>{productText('我的安装')}</h2><p>{productText('当前电脑已安装的技能，包括个人技能和从技能市场添加的技能。')}</p></div>
                  <button type="button" className="dsh-skill-browse-market" onClick={() => { setLibraryView('market') }}>
                    {productText('浏览技能市场 ')}<span aria-hidden="true">→</span>
                  </button>
                </div>
              ) : libraryView === 'uploads' ? (
                <div className="dsh-skill-upload-management">
                  <div className="dsh-skill-installed-heading">
                    <div><h2>{productText('我的上传')}</h2><p>{productText('管理已公开、私人保存和提交审核的个人技能。')}</p></div>
                    <button type="button" className="dsh-skill-browse-market" onClick={() => { setLibraryView('market') }}>
                      {productText('浏览技能市场 ')}<span aria-hidden="true">→</span>
                    </button>
                  </div>
                  <div className="dsh-skill-upload-navigation">
                    <div className="dsh-skill-sub-tabs" aria-label={productText('我的上传分类')}>
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
                          {label}
                          {id === 'reviews' && uploadAttentionCount > 0 && <span className="dsh-skill-unread-count">{uploadAttentionCount}</span>}
                        </button>
                      ))}
                    </div>
                    {uploadView === 'reviews' && (
                      <div className="dsh-skill-categories dsh-skill-review-filters" aria-label={productText('审核状态')}>
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
                            {label}
                            {(id === 'approved' || id === 'rejected') && unreadReviewStatuses.includes(id)
                              && <span className="dsh-skill-unread-count">{unreadReviewStatuses.filter(status => status === id).length}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : platformQuery.trim() === '' && featuredSkills.length > 0 && (
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
                        className="dsh-skill-featured-card" {...skillAccessProps(skill)}
                        onClick={() => { openDetail(skill) }}
                      >
                        <div className="dsh-skill-card-visual">
                          <div className="dsh-skill-featured-icon" style={{ background: skill.accent + '1f', color: skill.accent }}>
                            <SkillVisual skill={skill} />
                          </div>
                          {isInstalled(skill) && <span className="dsh-skill-installed-badge">{productText('已安装')}</span>}
                        </div>
                        <div className="dsh-skill-featured-body">
                          <div className="dsh-skill-card-meta">
                            <h3>{skill.name}</h3>
                            {hasVerifiedInstallCount(skill) && <small><DownloadIcon />{skill.installs}</small>}
                          </div>
                          <p>{skill.summary}</p>
                        </div>
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
                  <CatalogToolbar searchLabel={productText('搜索平台技能')}
                    keyword={platformKeyword} onKeyword={setPlatformKeyword}
                    onSearch={() => { setPlatformQuery(platformKeyword.trim()); setPlatformPage(1) }}
                    categories={categories.filter(item => item !== L.all).map(item => ({ key: item, name: item }))}
                    category={category === L.all ? '' : category} onCategory={(value) => { setCategory(value || L.all); setPlatformPage(1) }}
                    sort={platformSort} onSort={(value) => { setPlatformSort(value); setPlatformPage(1) }}
                    page={platform.page} pages={platform.pages} onPage={setPlatformPage}
                    loading={!remoteSkillsLoaded} onRefresh={() => { void refreshPlatformCatalog() }} />
                </section>
              )}

              {libraryView === 'uploads' && uploadView === 'reviews' ? (
                <div className="dsh-skill-review-list">
                  <div className="dsh-skill-review-list-header" aria-hidden="true">
                    <span>{productText('技能')}</span>
                    <span>{productText('提交版本')}</span>
                    <span>{productText('提交时间')}</span>
                    <span>{productText('状态')}</span>
                    <span>{productText('审核意见')}</span>
                    <span>{productText('操作')}</span>
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
                        <strong>{productText('v')}{skill.version}</strong>
                        {skill.publishedVersion && <span>{productText('当前公开版本 v')}{skill.publishedVersion}</span>}
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
                        {productText('查看')}</button>
                    </article>
                  ))}
                </div>
              ) : libraryView === 'installed' ? null : (
                <div className="dsh-skill-grid">
                  {displayedSkills.map(skill => (
                    <article
                      key={skill.id}
                      className="dsh-skill-card" {...skillAccessProps(skill)}
                      onClick={() => { openDetail(skill) }}
                    >
                      <div className="dsh-skill-card-visual">
                        <div className="dsh-skill-card-icon" style={{ background: skill.accent + '1f', color: skill.accent }}>
                          <SkillVisual skill={skill} />
                        </div>
                        {isInstalled(skill) && <span className="dsh-skill-installed-badge">{productText('已安装')}</span>}
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
                            {skill.source === 'personal' ? productText('个人') : productText('官方')}
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
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {visible.length === 0 && libraryView !== 'installed' && (
                libraryView === 'market' ? <div className="wanwei-platform-empty" role="status">
                  <svg className="wanwei-platform-empty-art" viewBox="0 0 240 176" aria-hidden="true" focusable="false">
                    <ellipse cx="120" cy="157" rx="84" ry="9" fill="currentColor" opacity=".06" />
                    <circle cx="118" cy="79" r="65" fill="currentColor" opacity=".05" />
                    <rect x="55" y="48" width="91" height="78" rx="12" fill="currentColor" opacity=".08" />
                    <rect x="68" y="35" width="91" height="78" rx="12" fill="var(--dsw-alias-bg-base, #fff)" stroke="currentColor" strokeWidth="3" />
                    <rect x="84" y="52" width="32" height="32" rx="8" fill="currentColor" opacity=".1" />
                    <path d="m100 58 4 8 8 2-8 3-4 8-3-8-8-3 8-2Z" fill="currentColor" opacity=".65" />
                    <path d="M126 59h17M126 72h12M85 97h48" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".45" />
                    <circle cx="157" cy="110" r="23" fill="var(--dsw-alias-bg-base, #fff)" stroke="currentColor" strokeWidth="4" />
                    <path d="m174 127 18 18" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
                    <path d="M40 37h10m-5-5v10M198 61h8m-4-4v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".3" />
                  </svg>
                  <h3>{productText('平台技能没有匹配结果')}</h3>
                </div> : <div className="dsh-skill-empty">
                  <div className="dsh-skill-empty-icon"><CategoryGlyph category={category} size={24} /></div>
                  <span>{uploadView === 'public'
                    ? productText('暂无审核通过的公开技能')
                    : uploadView === 'private'
                      ? productText('暂无私人技能')
                      : productText('暂无符合条件的审核记录')}</span>
                </div>
              )}
              {libraryView !== 'uploads' && <SkillHubSection
                active access={catalogAccess(network, true, 'skill')}
                installedOnly={libraryView === 'installed'} installedQuery={query}
                {...(libraryView === 'installed' ? { installedPlatforms: displayedSkills.map(skill => ({
                  id: skill.id, slug: skillSlug(skill), name: skill.name, summary: skill.summary,
                  searchText: `${skill.name} ${skill.summary} ${skill.category}`,
                  card: <article key={`platform:${skill.id}`} className="dsh-skill-card" {...skillAccessProps(skill)}
                    onClick={() => { openDetail(skill) }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openDetail(skill)
                      }
                    }}>
                    <div className="dsh-skill-card-visual">
                      <div className="dsh-skill-card-icon" style={{ background: skill.accent + '1f', color: skill.accent }}>
                        <SkillVisual skill={skill} />
                      </div>
                      <span className="dsh-skill-installed-badge">{productText('已安装')}</span>
                    </div>
                    <div className="dsh-skill-card-body">
                      <div className="dsh-skill-card-meta">
                        <span className="dsh-skill-card-category" style={{ background: skill.accent + '14', color: skill.accent }}>
                          {skill.category}
                        </span>
                        <span className={`dsh-skill-source ${skill.source === 'personal' ? 'personal' : 'official'}`}>
                          {skill.source === 'personal' ? productText('个人') : productText('官方')}
                        </span>
                        {hasVerifiedInstallCount(skill) && <small><DownloadIcon />{skill.installs}</small>}
                      </div>
                      <h2>{skill.name}</h2><p>{skill.summary}</p>
                    </div>
                  </article>,
                })) } : {})}
                request={skillhubRequest} invoke={desktopInvoke} onCount={() => {}} onNotice={setInstallMessage}
                onUse={(slug, name) => {
                  if (startSkillConversation === undefined) {
                    setInstallMessage({ kind: 'error', text: productText('对话服务尚未准备好，请稍后重试。') })
                    return
                  }
                  startSkillConversation(slug, name); closeMarket()
                }}
              />}
            </>}
          </>
        )}
        {adding && (
          <div className="dsh-skill-add-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAdding(false) }}>
            <form className="dsh-skill-add-dialog" onSubmit={(event) => { event.preventDefault(); void createSkill() }}>
              <header className="dsh-skill-add-header">
                <h2>{L.createSkill}</h2>
                <button type="button" onClick={() => { setAdding(false) }} aria-label={productText('关闭')}>×</button>
              </header>
              <label>{productText('中文显示名称')}<input autoFocus value={newSkill.name} onChange={(event) => { setNewSkill({ ...newSkill, name: event.target.value }) }} placeholder={productText('例如：会议纪要整理')} /></label>
              <label className="dsh-skill-add-field">
                <span className="dsh-skill-add-field-label">{productText('分类')}</span>
                <SkillCategorySelect
                  options={categories.slice(1)}
                  value={newSkill.category}
                  onChange={(value) => { setNewSkill(current => ({ ...current, category: value })) }}
                />
              </label>
              <label>{productText('用途说明')}<textarea value={newSkill.summary} onChange={(event) => { setNewSkill({ ...newSkill, summary: event.target.value }) }} placeholder={productText('说明这个技能何时使用、能完成什么任务')} /></label>
              <label>
                {productText('技能图标')}<span className="dsh-skill-add-icon-options" role="radiogroup" aria-label={productText('技能图标')}>
                  {DEFAULT_SKILL_ICONS.map((item) => {
                    const selected = newSkill.icon === item.value
                    return <button key={item.value} type="button" role="radio" aria-checked={selected} title={item.label} aria-label={item.label} className={selected ? 'active' : ''} onClick={() => { setNewSkill(current => ({ ...current, icon: item.value })) }}><DefaultSkillIcon icon={item.value} size={30} /></button>
                  })}
                </span>
                <small className="dsh-skill-add-icon-hint">{productText('选择一个通用技能图标，用于个人技能和审核通过后的技能市场展示。')}</small>
              </label>
              <fieldset className="dsh-skill-add-visibility">
                <legend>{productText('可见范围')}</legend>
                <div>
                  <button type="button" className={newSkill.visibility === 'private' ? 'active' : ''} onClick={() => { setNewSkill({ ...newSkill, visibility: 'private' }) }}><strong>{productText('私人')}</strong><span>{productText('仅自己使用；管理员可查看和下载')}</span></button>
                  <button type="button" className={newSkill.visibility === 'public' ? 'active' : ''} onClick={() => { setNewSkill({ ...newSkill, visibility: 'public' }) }}><strong>{productText('公开')}</strong><span>{productText('提交管理员审核')}</span></button>
                </div>
              </fieldset>
              <fieldset className="dsh-skill-add-source-field">
                <legend>{productText('个人技能来源')}</legend>
                <div className="dsh-skill-add-source-actions">
                  <button type="button" className="dsh-skill-add-directory" onClick={() => { void selectCustomSkillDirectory() }} disabled={installing !== null}>{productText('选择目录')}</button>
                  <label className={`dsh-skill-add-directory${installing !== null ? ' disabled' : ''}`}>
                    {productText('选择 ZIP')}<input
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
                </div>
                {customSkillSource !== null && (
                  <small
                    className="dsh-skill-add-selected"
                    title={customSkillSource.kind === 'directory' ? customSkillSource.path : customSkillSource.name}
                  >
                    {productText('已选择：')}{customSkillSource.kind === 'directory' ? customSkillSource.path : customSkillSource.name}
                  </small>
                )}
              </fieldset>
              <small className="dsh-skill-add-hint">{productText('请选择包含 SKILL.md 的完整目录或 ZIP。文件会安装到本机并安全上传；公开技能审核通过前不会出现在技能市场，更新已公开技能也需要再次审核。')}</small>
              <footer>
                <button type="button" onClick={() => { setAdding(false) }}>{productText('取消')}</button>
                <button
                  type="submit"
                  disabled={newSkill.name.trim() === '' || customSkillSource === null || installing !== null
                    || !categories.slice(1).includes(newSkill.category)}
                >
                  {newSkill.visibility === 'public' ? productText('提交审核并安装') : productText('保存并安装')}
                </button>
              </footer>
            </form>
          </div>
        )}
      </div>
      <Toast notice={installMessage} setNotice={setInstallMessage} />
    </div>
  )
}

function SkillMarketplaceAction({ wide, controller, services }: ActionProps) {
  const { loadPersonalSkills } = services
  // Clicking the entry again collapses its panel: the button reflects the
  // controller's open state so the toggle reads as selected while expanded.
  const open = useSyncExternalStore(
    listener => controller.subscribe(listener),
    () => controller.isOpen(),
  )
  const reviewAttention = useSyncExternalStore(subscribeReviewAttention, reviewAttentionSnapshot)
  const attentionCount = Object.keys(reviewAttention?.unread ?? {}).length
  useEffect(() => {
    if (loadPersonalSkills === undefined) return
    const refresh = () => { void loadPersonalSkills().catch(() => {}) }
    refresh()
    const interval = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refresh) }
  }, [])
  return (
    <button
      type="button"
      className={`dsh-skill-market-action${wide ? '' : ' rail'}${open ? ' active' : ''}`}
      aria-label={L.action}
      aria-expanded={open}
      title={L.action}
      onClick={() => { controller.toggle() }}
    >
      <SparkleIcon size={wide ? 16 : 18} />
      {wide && <span>{L.action}</span>}
      {attentionCount > 0 && <span className="dsh-skill-unread-count">{attentionCount > 99 ? '99+' : attentionCount}</span>}
    </button>
  )
}

export function SkillDraftPrefix({ draft, renderInput, settlePrefix }: PropsRuntime<'conversation.input.draft-prefix'>) {
  const match = /^\/([\w-]+)(?=\s|$)/u.exec(draft)
  const slug = match?.[1]
  const displayName = slug === undefined ? undefined : skillDisplayName(slug)
  const token = match?.[0]
  useEffect(() => {
    if (token === undefined || displayName === undefined) return
    settlePrefix(token.length, { source: 'skill', ref: token, clipboardText: token, label: displayName, appearance: 'skill' })
  }, [token, displayName, settlePrefix])
  return renderInput()
}

export const inject = ['slots', 'connection', 'conversation', 'sessions', 'workspaces', 'remote', 'remote.directoryPicker', 'remote.skills', 'wanweiNetwork']
export function apply(ctx: Context): void {
  const network = ctx.wanweiNetwork
  const controller = createPanelController(ctx, 'wanwei-skill-marketplace')
  const networkHooks = { network }
  registerNativeSkillCatalogBridge(ctx)
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const skillhubRequest = async (operation: string, payload: unknown) => rpcValue(await connection.rpc.call('/wanwei-skillhub', operation, payload))
  const conversation = ctx.get('conversation') as IConversation
  const sessions = ctx.get('sessions') as ISessions
  const workspaces: IWorkspaces = ctx.workspaces
  const createDefaultPreparation = () => skillSessionPreparation(workspaces, sessions, async (name) => {
    const path = await desktopInvoke('create_automatic_workspace', { name })
    if (typeof path !== 'string') throw new Error(productText('无法创建默认工作区，请稍后重试。'))
    return path
  })
  let defaultPreparation: (() => Promise<import('@deepseek-ai/dsh-session/types').SessionId>) | undefined
  ctx.effect(() => conversation.input.registerStagedSessionFactory(() => {
    defaultPreparation ??= createDefaultPreparation()
    return defaultPreparation()
  }), 'wanwei: default first-send workspace')
  ctx.effect(() => conversation.input.stagedDraft.subscribe(() => {
    if (conversation.input.stagedDraft.getSnapshot() === '') defaultPreparation = undefined
  }), 'wanwei: reset completed default workspace')
  const startSkillConversation = (slug: string, displayName: string) => {
    startSkillUse(sessions, conversation.input, slug, displayName)
  }
  const loadRemoteSkills = async () => {
    const raw = rpcValue(await connection.rpc.call('/desktop-auth', 'skill-list', {})) as { items?: unknown }
    const items = Array.isArray(raw.items) ? raw.items.filter((item): item is RemoteSkill => typeof item === 'object' && item !== null) : []
    rememberSkillDisplayNames(items.flatMap(item => typeof item.name === 'string' && typeof item.display_name === 'string'
      ? [{ slug: item.name, displayName: item.display_name }] : []))
    return items
  }
  const loadRemoteCategories = async () => {
    const raw = rpcValue(await connection.rpc.call('/desktop-auth', 'skill-categories', {})) as { items?: unknown }
    return Array.isArray(raw.items) ? raw.items.filter((item): item is RemoteSkillCategory => typeof item === 'object' && item !== null) : []
  }
  const loadRemoteSkillBundle = async (id: number) => rpcValue(await connection.rpc.call('/desktop-auth', 'skill-bundle', { id }))
  const recordRemoteSkillInstall = async (id: number, eventId?: string) => rpcValue(await connection.rpc.call('/desktop-auth', 'skill-download', { id, eventId }))
  const submitPersonalSkill = async (payload: unknown) => rpcValue(await connection.rpc.call('/desktop-auth', 'personal-skill-submit', payload))
  const loadPersonalSkills = async () => {
    const raw = rpcValue(await connection.rpc.call('/desktop-auth', 'personal-skill-list', {})) as { items?: unknown }
    const items = Array.isArray(raw.items) ? raw.items as RemotePersonalSkill[] : []
    recordReviewList(items)
    rememberSkillDisplayNames(items.flatMap(item => typeof item.name === 'string' && typeof item.display_name === 'string'
      ? [{ slug: item.name, displayName: item.display_name }] : []))
    return items
  }
  const loadReferencedSkill = async (slug: string): Promise<Skill | undefined> => {
    const sessionId = sessions.list.getSnapshot().current
    if (sessionId === undefined) return undefined
    const result = await ctx.remote.skills.list({ sessionId })
    if (!result.ok) throw new Error(result.error.message)
    const local = result.value.skills.find(skill => skill.name === slug)
    if (local === undefined) return undefined
    return { id: `reference-${slug}`, slug, name: local.displayName ?? skillDisplayName(slug) ?? slug,
      category: productText('本地技能'), tags: [], summary: local.description, description: local.description,
      installs: '0', accent: '#2563eb', icon: 'preset:assistant', version: '—', author: '—',
      source: 'personal', installable: false, marketplacePublished: false }
  }
  const services: MarketplaceServices = {
    skillhubRequest, loadRemoteSkills, loadReferencedSkill, startSkillConversation, loadRemoteCategories,
    loadRemoteSkillBundle, recordRemoteSkillInstall, submitPersonalSkill, loadPersonalSkills }
  const marketplaceUrl = (process.env.DSH_CLIENT_SKILL_MARKETPLACE_URL ?? 'https://skills.zjugis.com/').trim()
  const chooseDirectory = async (): Promise<string | null> => {
    const result = await ctx.remote.directoryPicker.pick()
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  ctx.slots.inject('conversation.input.draft-prefix', () =>
    ctx.slots.register({ name: 'conversation.input.draft-prefix' }, SkillDraftPrefix),
  )
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      { name: 'sidebar.footer.action', id: 'skill-marketplace', order: 40, inject: () => ({ controller, services, catalogAccess: network.catalogAccess, hooks: networkHooks }) },
      SkillMarketplaceAction,
    ),
  )
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'skill-marketplace-skills', order: 100, inject: () => ({ marketplaceUrl, controller, services, chooseDirectory, catalogAccess: network.catalogAccess, hooks: networkHooks }) },
      SkillMarketplace,
    ),
  )
}
