import { productText } from './locales/product.ts'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { NetworkController, NetworkState } from '@deepseek-ai/dsh-wanwei-oneapi-auth/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { projectPublishedExperts } from './expert-catalog.ts'
import type { ExpertDetailSection, RemoteExpert } from './expert-catalog.ts'
import { ExpertWebview, type ExpertLaunch } from './expert-webview.tsx'
import { ExpertDetailDialog } from './ExpertDetailDialog.tsx'
import { traceExpertAction } from './expert-diagnostics.ts'
import { ServiceUnavailable } from '@deepseek-ai/dsh-wanwei-feature-panels/client'
/* oxlint-disable @stylistic/max-len */
const defaultNetwork: NetworkState = { mode: 'internet', internalOrigins: [] }
type Expert = {
  requiresInternet?: boolean
  categoryOrder?: number
  id: string
  name: string
  role: string
  category: string
  summary: string
  tags: readonly string[]
  examples: readonly string[]
  accent: string
  icon: string
  scenario?: string
  materials?: string
  detailSections?: readonly ExpertDetailSection[]
  footerNote?: string
}

const EXPERTS: readonly Expert[] = [
  { id: 'geology-analysis', name: '地质条件分析专家', role: '地质环境与灾害易发性分析', category: '空间分析', summary: productText('提交项目地块范围，分析地质环境条件与地质灾害易发性，查看 Excel 明细和 Word 专业报告。'), tags: ['地质环境', '灾害易发性', '专业报告'], examples: ['分析这个地块的地质环境条件', '查看项目范围涉及的地质灾害易发分区'], accent: '#2563eb', icon: 'gis' },
  { id: 'third-survey-analysis', name: '三调土地利用现状分析专家', role: '三调地类、面积与权属现状分析', category: '空间分析', summary: productText('提交项目地块范围，分析三调土地利用现状、主要地类构成及耕地保护相关情况，查看专业报告和明细。'), tags: ['三调现状', '地类构成', '耕地保护'], examples: ['分析项目范围内三调地类构成', '核查耕地、永久基本农田与权属现状'], accent: '#059669', icon: 'survey' },
  { id: 'land-use-plan-review', name: '土地利用规划审查专家', role: '规划符合性与用途管制审查', category: '空间分析', summary: productText('提交项目地块范围，审查项目与规划管控要求的空间关系，识别冲突范围、风险事项和需进一步核实内容。'), tags: ['规划审查', '用途管制', '合规风险'], examples: ['审查项目范围与规划管控要求的关系', '识别永久基本农田和建设分区风险'], accent: '#2563eb', icon: 'planning' },
  { id: 'file-conversion-pdf', name: '文件转换与 PDF 工具专家', role: '常用文档、PDF 与图片批量处理', category: '办公工具', summary: productText('提供 Word 转 PDF、PDF 转图片、PDF 合并拆分、图片转 PDF，以及图片压缩与格式转换能力。'), tags: ['文件转换', 'PDF 工具', '图片处理'], examples: [], accent: '#2563eb', icon: 'writing' },
  { id: 'document-intelligence', name: '文档智能处理专家', role: '摘要提炼与版本差异分析', category: '办公工具', summary: productText('读取办公文档，提取摘要、重点、风险、时间节点和待办事项，或比较两份材料的文本变化。'), tags: ['文档摘要', '要点提取', '文档对比'], examples: [], accent: '#2563eb', icon: 'writing' },
  { id: 'meeting-minutes', name: '会议纪要专家', role: '录音转写与结构化纪要', category: '办公工具', summary: productText('提交会议录音、已有转写稿和相关文字材料，生成结构清晰的 Word 会议纪要。'), tags: ['录音转写', '会议纪要', '行动事项'], examples: ['根据会议录音生成正式纪要', '根据转写稿和项目材料整理待办事项'], accent: '#2563eb', icon: 'meeting' },
  { id: 'spatial-planning', name: '国土空间规划编制专家', role: '总体规划与详细规划顾问', category: '规划编制', summary: productText('协助梳理规划目标、空间格局、用地安排与成果章节，形成结构清晰的规划材料。'), tags: ['规划编制', '空间布局', '成果框架'], examples: ['根据现有资料梳理国土空间总体规划的章节框架', '对这份详细规划文本提取主要管控要求'], accent: '#2563eb', icon: 'planning' },
  { id: 'land-approval', name: '建设用地报批专家', role: '用地合规与材料审查顾问', category: '用地报批', summary: productText('聚焦项目选址、用地审批要件与材料完整性，帮助识别报批前需补充的内容。'), tags: ['用地报批', '合规核验', '材料清单'], examples: ['根据项目资料列出用地报批材料清单', '核查这份项目说明中可能影响报批的风险点'], accent: '#7c3aed', icon: 'policy' },
  { id: 'natural-resource-policy', name: '自然资源政策解读专家', role: '政策条款与执行口径顾问', category: '政策法规', summary: productText('将自然资源、规划、生态保护相关政策拆解为适用条件、责任事项和时间节点。'), tags: ['政策解读', '条款比对', '执行口径'], examples: ['概述这份政策中与项目建设有关的约束', '对比两份通知的适用范围与新增要求'], accent: '#dc2626', icon: 'policy' },
  { id: 'gis-analysis', name: 'GIS 空间分析专家', role: '空间数据与制图分析顾问', category: '空间分析', summary: productText('面向 GeoJSON、图层和规划底图，组织范围核对、叠加分析与可视化成果说明。'), tags: ['空间叠加', 'GIS 制图', '范围核验'], examples: ['根据这份 GeoJSON 说明可开展的空间分析', '整理多个图层的字段差异和合并建议'], accent: '#0ea5e9', icon: 'gis' },
  { id: 'land-survey', name: '国土调查监测专家', role: '调查成果与变化监测顾问', category: '调查监测', summary: productText('协助核对调查数据质量、变化图斑说明与三调相关成果的逻辑一致性。'), tags: ['三调成果', '变化监测', '数据质检'], examples: ['检查调查成果表中需要重点复核的字段', '按图斑变化整理一份核查任务清单'], accent: '#059669', icon: 'survey' },
  { id: 'ecological-restoration', name: '生态修复论证专家', role: '生态保护与修复方案顾问', category: '生态保护', summary: productText('梳理生态保护红线、修复目标、工程措施与论证要点，辅助形成项目说明。'), tags: ['生态修复', '保护约束', '方案论证'], examples: ['基于项目资料编制生态修复论证提纲', '提炼生态保护要求并列出需核实事项'], accent: '#16a34a', icon: 'ecology' },
  { id: 'property-registration', name: '不动产登记研判专家', role: '权属资料与登记流程顾问', category: '不动产登记', summary: productText('帮助整理权属资料、登记事项和疑点清单，便于与项目资料交叉核验。'), tags: ['权属核验', '登记资料', '疑点清单'], examples: ['从这些权属资料中整理登记核验重点', '生成不动产登记资料的缺失项清单'], accent: '#b45309', icon: 'property' },
  { id: 'gov-writing', name: '政务材料与汇报专家', role: '政企沟通与成果表达顾问', category: '政务协同', summary: productText('将复杂项目资料整理为适用于汇报、请示、纪要和项目推进的规范化文字材料。'), tags: ['政务写作', '项目汇报', '会议纪要'], examples: ['把项目进展整理为领导汇报提纲', '根据会议记录起草一份待办明确的纪要'], accent: '#e87922', icon: 'writing' },
  { id: 'farmland-protection', name: '耕地保护与永久基本农田专家', role: '耕地保有量与占补平衡顾问', category: '耕地地质', summary: productText('协助核对耕地保有量、永久基本农田占用与补划方案，梳理占补平衡与进出平衡要求。'), tags: ['永久基本农田', '占补平衡', '进出平衡'], examples: ['核对这个项目是否涉及永久基本农田', '整理占补平衡方案需要说明的要点'], accent: '#65a30d', icon: 'ecology' },
  { id: 'geohazard', name: '地质灾害防治专家', role: '地灾评估与隐患核查顾问', category: '耕地地质', summary: productText('面向地质灾害危险性评估、隐患点核查与防治要求，辅助选址与审查意见整理。'), tags: ['地灾评估', '隐患核查', '防灾审查'], examples: ['根据资料列出地灾评估需要收集的内容', '核查选址说明中的地质灾害风险表述'], accent: '#d97706', icon: 'survey' },
  { id: 'mineral-resource', name: '矿产资源管理专家', role: '矿政审批与压覆核查顾问', category: '耕地地质', summary: productText('协助梳理矿业权设置、压覆重要矿产资源核查与矿山生态修复要求。'), tags: ['压覆核查', '矿业权', '矿山修复'], examples: ['整理建设项目压覆矿产资源核查清单', '说明矿山生态修复方案的主要章节'], accent: '#ca8a04', icon: 'gis' },
  { id: 'land-supply', name: '土地储备与供应专家', role: '储备整理与供地方案顾问', category: '供地与利用', summary: productText('覆盖土地储备计划、整理成本核算、供地方式选择与出让方案要点梳理。'), tags: ['储备计划', '供地方案', '出让要点'], examples: ['梳理这块储备土地的供地方式选项', '整理出让方案需要明确的控制条件'], accent: '#0891b2', icon: 'property' },
  { id: 'idle-land', name: '闲置土地处置专家', role: '批后监管与闲置处置顾问', category: '供地与利用', summary: productText('协助认定闲置原因、梳理处置路径（延期、收回、置换等）与批后监管台账。'), tags: ['闲置认定', '处置路径', '批后监管'], examples: ['根据项目时间线判断闲置认定节点', '比较这宗闲置土地可选的处置方式'], accent: '#4f46e5', icon: 'planning' },
  { id: 'enforcement', name: '自然资源执法督察专家', role: '违法线索研判与督察整改顾问', category: '执法督察', summary: productText('协助研判卫片执法线索、违法用地情形与督察整改销号材料要求。'), tags: ['卫片执法', '线索研判', '整改销号'], examples: ['研判这个卫片图斑可能的违法情形', '整理督察整改销号需要的佐证材料'], accent: '#e11d48', icon: 'policy' },
  { id: 'urban-renewal', name: '城市更新规划专家', role: '更新单元与实施方案顾问', category: '规划编制', summary: productText('协助划定更新单元、梳理更新方式与实施方案框架，衔接国土空间规划管控要求。'), tags: ['更新单元', '实施方案', '存量盘活'], examples: ['梳理这个片区的更新方式与实施路径', '对照总规核查更新单元的管控要求'], accent: '#0d9488', icon: 'planning' },
  { id: 'asset-accounting', name: '自然资源资产核算专家', role: '确权登记与资产清查顾问', category: '调查监测', summary: productText('协助全民所有自然资源资产清查、所有权委托代理与资产报告编制要点梳理。'), tags: ['资产清查', '委托代理', '资产报告'], examples: ['整理资产清查需要归集的数据清单', '梳理所有权委托代理事项清单框架'], accent: '#9333ea', icon: 'survey' },
]

const LEGACY_EXPERT_AVATARS: Record<string, string> = {
  'geology-analysis': 'geology',
  'third-survey-analysis': 'third-survey',
  'land-use-plan-review': 'planning-review',
  'file-conversion-pdf': 'file-conversion',
  'document-intelligence': 'document-processing',
  'meeting-minutes': 'meeting-minutes',
}

function ExpertAvatar({ expert }: { expert: Expert }) {
  const shared = { width: 28, height: 28, viewBox: '0 0 28 28', fill: 'none', 'aria-hidden': true }
  if (expert.icon.startsWith('data:image/')) return <img src={expert.icon} alt="" aria-hidden="true" />
  const legacyAvatar = LEGACY_EXPERT_AVATARS[expert.id]
  if (legacyAvatar !== undefined) return <img src={`/expert-avatars/${legacyAvatar}.png`} alt="" aria-hidden="true" />
  if (expert.icon === 'planning') return <svg {...shared}><path d="M5 22V9l9-4 9 4v13" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M9 22v-6h10v6M10 10h.1M14 10h.1M18 10h.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  if (expert.icon === 'policy') return <svg {...shared}><path d="M8 4h10l4 4v15H8z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M18 4v5h4M11 14h8M11 18h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  if (expert.icon === 'gis') return <svg {...shared}><path d="m5 8 7-3 5 3 6-3v15l-6 3-5-3-7 3V8Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M12 5v15M17 8v15" stroke="currentColor" strokeWidth="2" /></svg>
  if (expert.icon === 'survey') return <svg {...shared}><circle cx="14" cy="14" r="8" stroke="currentColor" strokeWidth="2" /><path d="M14 6v3M14 19v3M6 14h3M19 14h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  if (expert.icon === 'ecology') return <svg {...shared}><path d="M21 5c-9 .4-14 5-14 12 0 3.4 2.5 5.8 5.6 5.8C19 22.8 22 15.7 21 5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M8 20c3-3.8 6.1-6.3 10.4-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  if (expert.icon === 'property') return <svg {...shared}><path d="m5 13 9-8 9 8v10H5V13Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M11 23v-6h6v6" stroke="currentColor" strokeWidth="2" /></svg>
  return <svg {...shared}><path d="M7 5h14v18H7z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M10 10h8M10 14h8M10 18h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
}

type ExpertMarketDetail = { id: string; name: string; role: string; summary: string; icon: string; tags: readonly string[]; examples: readonly string[]; accent: string; scenario?: string; materials?: string; detailSections?: readonly ExpertDetailSection[]; footerNote?: string }

/** Render independently owned expert tabs; pending launches are invalidated on logout and disposal.
 * @param props - Directory, launch and presentation operations supplied by the expert plugin.
 * @returns Catalog and mounted expert workbenches.
 */
export function ExpertMarket({ loadExperts, launchExpert, prepareExpertWorkspace, network }: {
  network?: HostObservable<NetworkState> & Pick<NetworkController, 'catalogAccess'>
  loadExperts?: () => Promise<readonly RemoteExpert[]>
  launchExpert?: (key: string) => Promise<{ url: string; ticket: string }>
  prepareExpertWorkspace?: () => Promise<void>
} = {}) {
  const internetCatalogAccess = (state: NetworkState, requiresInternet: boolean) =>
    network?.catalogAccess(state, requiresInternet) ?? 'available'
  const networkState = useSyncExternalStore(listener => network ? network.subscribe(listener) : () => {},
    () => network ? network.getSnapshot() : defaultNetwork)
  const [category, setCategory] = useState('全部')
  const [selected, setSelected] = useState<ExpertMarketDetail | null>(null)
  const [publishedExperts, setPublishedExperts] = useState<readonly Expert[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [expertTabs, setExpertTabs] = useState<readonly ExpertLaunch[]>([])
  const [activeExpertTab, setActiveExpertTab] = useState<string | null>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  useEffect(() => { traceExpertAction('library-open') }, [])
  useEffect(() => {
    const panel = workspaceRef.current?.closest('.dsh-skill-market-panel')
    panel?.classList.toggle('dsh-expert-view-open', activeExpertTab !== null)
    return () => { panel?.classList.remove('dsh-expert-view-open') }
  }, [activeExpertTab])
  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const launchRevision = useRef(0)
  const launchPending = useRef(false)
  useEffect(() => {
    const onAuthState = (event: Event) => {
      if ((event as CustomEvent<{ authenticated?: boolean }>).detail.authenticated === false) {
        launchRevision.current++
        launchPending.current = false
        setLaunching(false)
        setLaunchError(null)
        setExpertTabs([])
        setActiveExpertTab(null)
        setSelected(null)
      }
    }
    window.addEventListener('wanwei:auth-state', onAuthState)
    return () => {
      launchRevision.current++
      launchPending.current = false
      window.removeEventListener('wanwei:auth-state', onAuthState)
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    setCatalogLoading(true)
    setLoadError(null)
    if (loadExperts === undefined) {
      setLoadError('专家目录服务不可用')
      setCatalogLoading(false)
      return () => { cancelled = true }
    }
    const run = (): void => {
      void loadExperts().then((items) => {
        if (cancelled) return
        setPublishedExperts(projectPublishedExperts(items, EXPERTS))
        setLoadError(null)
        setCatalogLoading(false)
      }).catch((error: unknown) => {
        if (cancelled) return
        failures += 1
        // Same localhost blip that fails a connector card must not leave the
        // expert catalog on the service-unavailable illustration.
        if (failures >= 3) {
          setLoadError(error instanceof Error ? error.message : '专家目录加载失败')
          setCatalogLoading(false)
        }
        timer = setTimeout(run, failures >= 3 ? 1500 : 0)
      })
    }
    run()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [loadExperts])
  const accessibleExperts = publishedExperts.filter(expert => internetCatalogAccess(networkState, expert.requiresInternet !== false) !== 'hide')
  const categories = ['全部', ...new Set([...accessibleExperts]
    .sort((left, right) => (left.categoryOrder ?? 0) - (right.categoryOrder ?? 0))
    .map(expert => expert.category))]
  const visibleExperts = category === '全部' ? accessibleExperts : accessibleExperts.filter(expert => expert.category === category)
  useEffect(() => {
    if (category !== '全部' && !publishedExperts.some(expert => expert.category === category
      && internetCatalogAccess(networkState, expert.requiresInternet !== false) !== 'hide')) setCategory('全部')
  }, [category, publishedExperts, networkState])
  const openExpert = (expert: Expert) =>{  setSelected({ id: expert.id, name: expert.name, role: expert.role, summary: expert.summary, icon: expert.icon, tags: expert.tags, examples: expert.examples, accent: expert.accent, ...(expert.scenario === undefined ? {} : { scenario: expert.scenario }), ...(expert.materials === undefined ? {} : { materials: expert.materials }), ...(expert.detailSections === undefined ? {} : { detailSections: expert.detailSections }), ...(expert.footerNote === undefined ? {} : { footerNote: expert.footerNote }) }) }
  const startExpert = async () => {
    traceExpertAction('start-enter')
    const target = publishedExperts.find(expert => expert.id === selected?.id)
    if (target && internetCatalogAccess(networkState, target.requiresInternet !== false) !== 'available') return
    if (selected === null || launchExpert === undefined || launchPending.current) {
      traceExpertAction('start-ignored')
      return
    }
    if (expertTabs.some(tab => tab.id === selected.id)) {
      setActiveExpertTab(selected.id)
      setSelected(null)
      return
    }
    const revision = ++launchRevision.current
    launchPending.current = true
    setLaunching(true)
    setLaunchError(null)
    try {
      traceExpertAction('request-start')
      const { url, ticket } = await launchExpert(selected.id)
      traceExpertAction('request-success')
      if (revision !== launchRevision.current) return
      // Layout and native window changes are presentation-only; a failed maximize
      // must never discard an otherwise valid expert launch ticket.
      if (prepareExpertWorkspace !== undefined) {
        traceExpertAction('prepare-start')
        try { await prepareExpertWorkspace() } catch { /* keep opening the expert */ }
        traceExpertAction('prepare-done')
        if (revision !== launchRevision.current) return
      }
      setExpertTabs(tabs => [...tabs, { id: selected.id, name: selected.name, url, ticket }])
      setActiveExpertTab(selected.id)
      traceExpertAction('launch-mounted')
      setSelected(null)
    } catch (error) {
      traceExpertAction('launch-error')
      if (revision === launchRevision.current) setLaunchError(error instanceof Error ? error.message : String(error))
    } finally {
      if (revision === launchRevision.current) {
        launchPending.current = false
        setLaunching(false)
      }
    }
  }
  useEffect(() => {
    const target = publishedExperts.find(expert => expert.id === selected?.id)
    if (target && internetCatalogAccess(networkState, target.requiresInternet !== false) !== 'available') {
      launchRevision.current++
      launchPending.current = false
      setLaunching(false)
      setSelected(null)
    }
  }, [networkState, publishedExperts, selected])
  const catalog = <section className="dsh-expert-market">
    {catalogLoading ? <p role="status">{productText('正在连接服务…')}</p> : loadError !== null
      ? <ServiceUnavailable variant="experts" title={productText('暂时无法连接专家库')}
        description={productText('当前网络无法连接专家服务，请检查网络连接或联系管理员。')} /> :
      <><div className="dsh-expert-category-row">{categories.map(item => <button type="button" key={item} className={category === item ? 'active' : ''} onClick={() =>{  setCategory(item) }}>{item}</button>)}</div>{visibleExperts.length === 0 && <p>{productText('当前暂无已上架的专家。')}</p>}<div className="dsh-expert-grid">{visibleExperts.map(expert => <button type="button" className="dsh-expert-card" key={expert.id} disabled={internetCatalogAccess(networkState, expert.requiresInternet !== false) !== 'available'} title={internetCatalogAccess(networkState, expert.requiresInternet !== false) !== 'available' ? productText('当前网络环境不可达，请检查您的网络') : undefined} onClick={() =>{  openExpert(expert) }}><span className="dsh-expert-avatar" style={{ background: `${expert.accent}18`, color: expert.accent }}><ExpertAvatar expert={expert} /></span><div><strong>{expert.name}</strong><small>{expert.role}</small></div><p>{expert.summary}</p><footer>{expert.tags.map(tag => <b key={tag}>{tag}</b>)}</footer></button>)}</div></>
    }
    {selected !== null && <ExpertDetailDialog expert={selected} launching={launching} launchError={launchError} onClose={() => { setSelected(null) }} onStart={() => { void startExpert() }} />}
  </section>
  return <section ref={workspaceRef} className="dsh-expert-active">
    <nav className="dsh-expert-workspace-tabs" aria-label={productText('专家工作台标签')}>
      <button type="button" className={activeExpertTab === null ? 'active' : ''} aria-current={activeExpertTab === null ? 'page' : undefined} onClick={() => { setActiveExpertTab(null) }}>{productText('专家')}</button>
      {expertTabs.map(tab => <span key={tab.id} className={`dsh-expert-workspace-tab${activeExpertTab === tab.id ? ' active' : ''}`}>
        <button type="button" className="dsh-expert-workspace-tab-label" aria-current={activeExpertTab === tab.id ? 'page' : undefined} onClick={() => { setActiveExpertTab(tab.id) }}>{tab.name}</button>
        <button type="button" className="dsh-expert-workspace-tab-close" aria-label={productText('关闭{0}标签', [tab.name])} title={productText('关闭{0}标签', [tab.name])} onClick={() => {
          const remaining = expertTabs.filter(item => item.id !== tab.id)
          setExpertTabs(remaining)
          if (activeExpertTab === tab.id) {
            const index = expertTabs.findIndex(item => item.id === tab.id)
            setActiveExpertTab(remaining[Math.min(index, remaining.length - 1)]?.id ?? null)
          }
        }}>×</button>
      </span>)}
    </nav>
    {launchError !== null && selected === null && <p role="alert">{launchError}</p>}
    {activeExpertTab === null && catalog}
    {expertTabs.map(tab => <ExpertWebview key={tab.id} launch={tab} visible={activeExpertTab === tab.id} onError={(message) => {
      setLaunchError(message)
      setExpertTabs(tabs => tabs.filter(item => item.id !== tab.id))
      setActiveExpertTab(active => active === tab.id ? null : active)
    }} />)}
  </section>
}
