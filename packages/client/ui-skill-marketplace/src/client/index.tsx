import { useEffect, useMemo, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import './marketplace.css'

type SkillParam = { name: string; type: string; required: boolean; description: string; defaultValue?: string }
type Skill = {
  id: string
  name: string
  category: string
  tags: string[]
  summary: string
  description: string
  installs: string
  accent: string
  icon: string
  version: string
  author: string
  featured?: boolean
  params?: SkillParam[]
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

type Connector = {
  id: string
  name: string
  summary: string
  scope: string
  icon: string
  accent: string
}

type Automation = {
  id: string
  name: string
  summary: string
  trigger: string
  steps: readonly string[]
  accent: string
}

type DesktopBridge = { core?: { invoke?: (command: string, argumentsValue?: unknown) => Promise<unknown> } }

function skillSlug(skill: Skill): string {
  const value = skill.id.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `market-${value || 'custom-skill'}`
}

function skillContent(skill: Skill): string {
  return `# ${skill.name}\n\n${skill.description}\n\n## 主要能力\n\n- ${skill.summary}\n`
}

function desktopInvoke(command: string, argumentsValue: unknown): Promise<unknown> {
  const bridge = (window as Window & { __TAURI__?: DesktopBridge }).__TAURI__
  const invoke = bridge?.core?.invoke
  if (typeof invoke !== 'function') {
    return Promise.reject(new Error('本地安装仅支持已安装的 ZJUGIS Harness 桌面端'))
  }
  return invoke(command, argumentsValue)
}

const L = {
  title: '技能广场',
  close: '关闭技能广场',
  subtitle: '发现可复用的工作流和智能助手',
  search: '搜索技能',
  myInstalled: '我安装的',
  addSkill: '添加技能',
  all: '全部',
  featured: '精选技能',
  refresh: '换一批',
  recommend: '推荐',
  skillHub: 'SkillHub',
  suite: '套件',
  installed: '已安装',
  install: '安装',
  count: '次安装',
  empty: '没有匹配的技能',
  action: '技能广场',
  back: '返回',
  detailInstall: '安装技能',
  version: '版本',
  author: '作者',
  params: '参数配置',
  noParams: '该技能无需配置参数',
  preview: '预览',
  uninstall: '卸载',
  createSkill: '添加本地技能',
  skills: '技能',
  experts: '专家团',
  connectors: '连接器',
  automations: '自动化',
}

const CATEGORIES = [
  L.all,
  '空间制图',
  '专业写作',
  '研究咨询',
  '办公文档',
  '数据分析',
]

const MOCK_SKILLS: readonly Skill[] = [
  { id: 'land-evaluation', name: '土地评估报告', category: '空间制图', tags: ['推荐'], summary: '写土地评估报告，基于宗地数据与基准地价生成规范化评估文书。', description: '面向土地估价场景的报告生成技能，覆盖估价方法选择（市场比较法、收益还原法、剩余法等）、参数取值说明、结果校验与报告排版，输出符合行业规范的土地评估报告。', installs: '53', accent: '#2563eb', icon: '地', version: '1.0.0', author: '规划测绘院', featured: true, params: [{ name: 'benchmarkPrice', type: 'number', required: false, description: '所在区域基准地价（元/平方米），缺省时按最新公示地价取值' }] },
  { id: 'arcgis-plugin', name: 'ArcGIS插件创建', category: '空间制图', tags: ['推荐', 'SkillHub', '套件'], summary: '当用户要求创建、修改或打包 ArcGIS/ArcMap .esriAddIn 插件时使用。', description: '指导创建、修改或打包 ArcGIS/ArcMap .esriAddIn 插件与工具条，例如“帮我做一个 ArcGIS 插件/小工具”。覆盖工程结构、AddIn 配置、工具类编写与本地安装验证。', installs: '284', accent: '#0ea5e9', icon: 'A', version: '1.2.0', author: 'GIS 工具链', featured: true, params: [{ name: 'arcgisVersion', type: 'string', required: true, description: '目标 ArcGIS Desktop 版本', defaultValue: '10.8' }] },
  { id: 'gov-doc', name: '公文写作助手', category: '办公文档', tags: ['推荐'], summary: '中国党政机关公文写作知识库，覆盖通知、请示、报告、纪要等文种。', description: '当用户不知道该选哪种文种（通知/请示/报告/函/意见/决定/批复/公告/通报）、询问公文格式或需要起草公文时使用，提供文种选择、版式规范与范文参考。', installs: '262', accent: '#e60012', icon: '公', version: '2.0.0', author: '办公助手', featured: true },
  { id: 'residential-judicial', name: '房地产住宅司法计算', category: '数据分析', tags: ['推荐'], summary: '用于房地产估价机构开展住宅类涉房地产司法评估时的计算与取证。', description: '面向司法评估场景的住宅价值计算工具，覆盖法院委托、权属登记、现场查勘、买卖与租赁案例及可检核等流程，输出可追溯的计算过程。', installs: '122', accent: '#8b5cf6', icon: '司', version: '1.1.0', author: '估价计算组' },
  { id: 'residential-mortgage', name: '房地产住宅抵押计算', category: '数据分析', tags: ['SkillHub'], summary: '用于住宅房地产抵押估价，独立读取当前项目的权属、查勘与案例数据。', description: '读取抵押估价项目的权属、查勘、买卖案例、租赁与参数资料，取得可核验参数，完成抵押价值计算并生成过程表。', installs: '110', accent: '#8b5cf6', icon: '押', version: '1.0.2', author: '估价计算组' },
  { id: 'gis-merge', name: 'GIS图层合并', category: '空间制图', tags: ['推荐'], summary: '从一个或多个文件夹中找到所有 .gdb，并将指定图层合并为一个或多个图层。', description: '当用户要求批量合并空间数据时使用：扫描目录下的 .gdb 文件，按图层名归并要素类，处理坐标系差异与字段映射，输出合并结果。', installs: '280', accent: '#06b6d4', icon: '合', version: '1.3.0', author: 'GIS 工具链', featured: true },
  { id: 'gis-export', name: 'GIS制图导出', category: '空间制图', tags: ['SkillHub', '套件'], summary: '将 .mpk 或 .mxd 数据制图并导出为 PNG 规划图纸。', description: '当用户需要将工程包或地图文档批量出图时使用，仅适用于 Windows + ArcGIS Desktop 10.x 环境，支持图框整饰、比例尺与图例自动配置。', installs: '277', accent: '#06b6d4', icon: '出', version: '1.2.1', author: 'GIS 工具链' },
  { id: 'invoice-batch', name: '发票批量汇总', category: '办公文档', tags: ['推荐'], summary: '批量解析 PDF 发票并生成格式化 Excel 汇总表，适用于报销粘贴与台账登记。', description: '批量读取 PDF 发票（增值税专用/普通发票、电子发票等），提取金额、税额、开票日期与购销方信息，生成报销汇总、财务对账等场景的 Excel 台账。', installs: '35', accent: '#f59e0b', icon: '票', version: '1.0.4', author: '财务效率组' },
  { id: 'data-insight', name: '数据分析洞察家', category: '数据分析', tags: ['推荐'], summary: '从 csv / xlsx / 数据库中识别规律，做分组/相关/趋势分析并生成结构化报告。', description: '数据集分析与洞察提取工具：自动识别字段类型，执行分组统计、相关性分析与趋势检测，输出带图表说明的结构化分析报告。', installs: '36', accent: '#10b981', icon: '数', version: '1.1.0', author: '数据工坊', featured: true },
  { id: 'data-clean', name: '数据清洗诊断', category: '数据分析', tags: ['SkillHub'], summary: '通用数据清洗与质量诊断工具，覆盖社科、自然科学及工程领域常见质量问题。', description: '对提交的数据文件做缺失值、异常值、重复记录与类型一致性诊断，给出清洗建议并可执行标准化清洗流程。', installs: '36', accent: '#10b981', icon: '洗', version: '1.0.6', author: '数据工坊' },
  { id: 'qa-table', name: '问卷表格匹配', category: '办公文档', tags: ['SkillHub'], summary: '在两张表之间做模糊文本匹配（可选）回填数据，只需查看匹配结果即可直接使用。', description: '按用户需求在两张工作表间做模糊匹配并回填，支持轻量模式（仅输出匹配对照）与完整模式（直接写回目标表）。', installs: '37', accent: '#3b82f6', icon: '配', version: '1.0.3', author: '办公助手' },
  { id: 'word-edit', name: 'Word文档编辑', category: '办公文档', tags: ['推荐'], summary: 'Word 文档修订与结构化编辑工作流指导，支持修订追踪与批注工作流。', description: '触发：需要 tracked changes（修订追踪）/批注工作流，或直接编辑 .docx 结构。提供样式、目录、域与修订管理的标准操作路径。', installs: '38', accent: '#2563eb', icon: 'W', version: '1.4.0', author: '办公助手', featured: true },
  { id: 'ppt-demo', name: 'PPT演示文稿处理', category: '办公文档', tags: ['SkillHub'], summary: 'PPT 演示文稿创建、编辑与分析，支持内容生成、修改与主题/字体分析。', description: '支持 .pptx 文件的内容生成、版式修改、主题与字体分析、OOXML 原生结构操作，适用于汇报材料快速成稿。', installs: '37', accent: '#f97316', icon: 'P', version: '1.2.0', author: '办公助手' },
  { id: 'excel-table', name: 'Excel表格处理', category: '办公文档', tags: ['推荐'], summary: 'Excel 电子表格创建、编辑与可视化，支持公式、格式、图表与金融模型规范。', description: '触发：用户要求新建/修改 Excel 表格、编写公式、制作图表或搭建预算/测算模型。遵循表格建模规范，输出可审计的电子表格。', installs: '36', accent: '#16a34a', icon: 'E', version: '1.5.0', author: '办公助手', featured: true },
  { id: 'questionnaire-design', name: '问卷量表设计', category: '研究咨询', tags: ['SkillHub'], summary: '问卷/量表设计工具，覆盖学术研究问卷、临床量表、市场调研与组织行为调查。', description: '提供题项编写、量表选择、信效度建议与排版输出，适用于学术研究、临床与市场调研场景的问卷设计。', installs: '35', accent: '#ec4899', icon: '问', version: '1.0.5', author: '研究咨询所' },
  { id: 'feasibility', name: '可行性研究报告', category: '研究咨询', tags: ['推荐'], summary: '起草和审查中国政府投资项目可行性研究报告（可研报告）。', description: '当用户要“写可研”、“可行性研究”、“项目立项报告”时使用，按发改部门规范组织章节、投资估算与经济评价内容。', installs: '282', accent: '#6366f1', icon: '可', version: '2.1.0', author: '研究咨询所', featured: true },
  { id: 'case-compare', name: '规划案例比较分析', category: '研究咨询', tags: ['SkillHub'], summary: '“规划行业案例比较分析”，对多个城市/地区的规划实践进行结构化对比。', description: '覆盖国土空间规划、产业发展、城市更新、乡村建设等主题，输出案例对比矩阵与经验启示。', installs: '258', accent: '#6366f1', icon: '比', version: '1.3.0', author: '研究咨询所' },
  { id: 'policy-analysis', name: '政策文件解析', category: '研究咨询', tags: ['推荐'], summary: '政府政策文件解析，提取结构化信息和关键要求。', description: '对政策原文做条款拆解，提取适用范围、主管部门、关键指标与时间节点，生成结构化政策要点卡片。', installs: '262', accent: '#ef4444', icon: '策', version: '1.6.0', author: '研究咨询所', featured: true },
  { id: 'population-forecast', name: '人口规模预测', category: '研究咨询', tags: ['SkillHub'], summary: '规划人口预测，当用户需要预测城市/地区未来人口规模时使用。', description: '支持综合增长率法、劳动力需求法、灰色预测 GM(1,1) 等方法，输出多方案人口规模预测结果与参数说明。', installs: '250', accent: '#0ea5e9', icon: '人', version: '1.1.2', author: '研究咨询所' },
  { id: 'spatial-econometrics', name: '空间计量经济学', category: '数据分析', tags: ['SkillHub'], summary: '空间计量经济学工具，支持空间权重矩阵构建、Moran I / Geary C 检验。', description: '适用于地理/网络数据的研究分析，提供空间自相关检验、空间滞后与误差模型估计的完整流程。', installs: '36', accent: '#8b5cf6', icon: '空', version: '1.0.1', author: '数据工坊' },
  { id: 'arcpy-script', name: 'ArcPy脚本生成', category: '空间制图', tags: ['SkillHub'], summary: 'ArcPy 脚本生成，当用户需要编写 ArcGIS/ArcPy 自动化脚本时使用。', description: '生成或调试 GIS 自动化脚本，覆盖要素分析、裁剪、投影转换、批量制图等常见 ArcPy 场景。', installs: '251', accent: '#0ea5e9', icon: 'Py', version: '1.4.0', author: 'GIS 工具链' },
  { id: 'map-coloring', name: '规划标准配色', category: '空间制图', tags: ['推荐'], summary: '规划标准配色方案，图纸与报告的标准配色，使用国土空间规划用地分类色标。', description: '按《国土空间规划用地用海分类》提供三调标准色标，支持图纸、图例与报告配色的统一输出。', installs: '271', accent: '#22c55e', icon: '色', version: '1.2.0', author: '规划测绘院' },
  { id: 'contract-draft', name: '规划合同起草', category: '专业写作', tags: ['SkillHub'], summary: '起草规划编制合同（规划编制/咨询/测绘/技术服务），支持“写一份合同”等场景。', description: '按规划行业惯例生成合同草案，覆盖工作范围、成果交付、付款节点与违约责任条款，并提示风险点。', installs: '255', accent: '#f59e0b', icon: '合', version: '1.1.0', author: '专业写作室' },
  { id: 'research-report', name: '咨询报告生成器', category: '专业写作', tags: ['推荐'], summary: '生成研究、规划、政府服务和项目汇报中的结构化咨询报告。', description: '面向一类完整的项目任务：研究一个行业、分析一项政策、准备一次汇报，输出逻辑清楚、结构完整的咨询报告。', installs: '261', accent: '#6366f1', icon: '报', version: '1.7.0', author: '专业写作室' },
  { id: 'text-extract', name: '文本结构化提取', category: '专业写作', tags: ['SkillHub'], summary: '从非结构化文本中提取结构化数据的通用工作流，由用户定义字段。', description: '调用 extract_structured_data 工具完成提取，内置字段定义、抽样校验与结果导出流程。', installs: '36', accent: '#3b82f6', icon: '提', version: '1.0.2', author: '专业写作室' },
  { id: 'template-imitation', name: '模板仿写生成', category: '专业写作', tags: ['SkillHub'], summary: '按用户提供的模板文件和参考资料，仿写生成 Word 格式文档。', description: '触发场景：用户提供“模板”+“参考资料/素材”，要求“按此模板”生成文档；保持模板版式与章节结构，填充新内容。', installs: '36', accent: '#3b82f6', icon: '仿', version: '1.0.0', author: '专业写作室' },
]

const EXPERT_TEAMS: readonly ExpertTeam[] = [
  { id: 'planning-review', name: '国土空间规划审查专家团', summary: '由政策解读、GIS 制图、文本审查与报告交付技能协同完成规划材料审查。', members: ['规划主理人', '政策分析师', 'GIS 工程师', '报告审核员'], skills: ['政策文件解析', 'GIS 制图导出', '咨询报告生成器'], accent: '#2563eb' },
  { id: 'tender-delivery', name: '投标文件交付专家团', summary: '围绕招标要求提取、资格核验、技术方案和最终文档交付组织多技能工作流。', members: ['投标主理人', '文档分析师', '方案顾问', '交付校验员'], skills: ['文本结构化提取', '公文写作助手', 'Word 文档编辑'], accent: '#7c3aed' },
  { id: 'data-research', name: '数据研判专家团', summary: '从数据清洗、统计分析到图表和结论报告的一体化研判流程。', members: ['研究主理人', '数据分析师', '图表设计师'], skills: ['数据清洗诊断', '数据分析洞察家', 'Excel 表格处理'], accent: '#059669' },
]

const CONNECTORS: readonly Connector[] = [
  { id: 'zj-dingtalk', name: '浙政钉', summary: '接入组织通讯录、待办与消息通知，用于将任务结果送达政务协同入口。', scope: '需管理员授权', icon: '政', accent: '#1677ff' },
  { id: 'office-mail', name: '办公邮箱', summary: '读取和起草授权范围内的办公邮件，支持将审阅结果作为邮件草稿交付。', scope: 'OAuth 授权', icon: '邮', accent: '#0f766e' },
  { id: 'internal-mail', name: '内部邮箱', summary: '适配内网 SMTP / Exchange 环境，专用于不出网的邮件通知与归档。', scope: '需管理员配置', icon: '内', accent: '#7c3aed' },
  { id: 'doc-center', name: '政务文档中心', summary: '连接受控文档库，在授予的目录范围内检索、读取和提交交付物。', scope: '按目录授权', icon: '文', accent: '#b45309' },
]

const AUTOMATIONS: readonly Automation[] = [
  { id: 'daily-brief', name: '每日待办与政策简报', summary: '工作日早晨汇总待办、已接入来源的通知和政策要点，生成一份简报。', trigger: '工作日 08:30', steps: ['读取待办', '汇总政策', '生成简报'], accent: '#2563eb' },
  { id: 'tender-watch', name: '投标文件变更提醒', summary: '监测指定工作区的招标文件变动，提取变更项并通知项目负责人。', trigger: '文件变更时', steps: ['检测变更', '解析差异', '发送提醒'], accent: '#dc2626' },
  { id: 'weekly-report', name: '周报自动汇总', summary: '每周收集本工作区的成果与进展，整理为可编辑的 Word 周报草稿。', trigger: '每周五 16:30', steps: ['汇总成果', '提炼进展', '输出周报'], accent: '#059669' },
]

const SUB_TABS = [
  { id: 'recommend', label: L.recommend },
  { id: 'skillHub', label: L.skillHub },
  { id: 'suite', label: L.suite },
]

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

function SparkleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5 14.4 9.6 21.5 12 14.4 14.4 12 21.5 9.6 14.4 2.5 12 9.6 9.6 Z" />
    </svg>
  )
}

function ArrowLeftIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  )
}

type Controller = { open(): void; close(): void; subscribe(listener: (open: boolean) => void): () => void }
declare global {
  interface Window {
    __skillMarketplaceController?: Controller
  }
}

function createController(): Controller {
  const listeners = new Set<(open: boolean) => void>()
  const controller: Controller = {
    open: () => { listeners.forEach((listener) => { listener(true) }) },
    close: () => { listeners.forEach((listener) => { listener(false) }) },
    subscribe: (listener: (open: boolean) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
  }
  if (typeof window !== 'undefined') {
    window.__skillMarketplaceController = controller
  }
  return controller
}

// Slot props are assembled separately for each rendered seat. The action and
// overlay therefore share this module-level state owner instead of relying on
// a mutable controller being carried through two independent slot payloads.
const skillMarketplaceController = createController()

type OverlayProps = PropsRuntime<'shell.overlay'> & { marketplaceUrl: string }
type ActionProps = PropsRuntime<'sidebar.footer.action'> & SidebarFooterActionOwnerProps

function SkillDetail({ skill, onBack, installed, onToggleInstall }: {
  skill: Skill
  onBack: () => void
  installed: boolean
  onToggleInstall: () => void
}) {
  return (
    <div className="dsh-skill-detail">
      <button type="button" className="dsh-skill-detail-back" onClick={onBack}>
        <ArrowLeftIcon /> {L.back}
      </button>
      <div className="dsh-skill-detail-header">
        <div className="dsh-skill-detail-icon" style={{ background: skill.accent }}>{skill.icon}</div>
        <div className="dsh-skill-detail-info">
          <h1>{skill.name}</h1>
          <p>{skill.summary}</p>
          <div className="dsh-skill-detail-meta">
            <span>{L.version}: {skill.version}</span>
            <span>{L.author}: {skill.author}</span>
            <span>{skill.installs} {L.count}</span>
          </div>
        </div>
        <button
          type="button"
          className={`dsh-skill-detail-install${installed ? ' installed' : ''}`}
          onClick={onToggleInstall}
        >
          {installed ? L.uninstall : L.detailInstall}
        </button>
      </div>
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

function ExpertTeams() {
  return <div className="dsh-skill-special-grid">
    {EXPERT_TEAMS.map(team => <article className="dsh-skill-special-card" key={team.id}>
      <div className="dsh-skill-special-icon" style={{ background: team.accent }}>团</div>
      <div className="dsh-skill-special-head"><h2>{team.name}</h2><span>多技能工作流</span></div>
      <p>{team.summary}</p>
      <div className="dsh-skill-special-label">协作角色</div>
      <div className="dsh-skill-chip-row">{team.members.map(member => <span key={member}>{member}</span>)}</div>
      <div className="dsh-skill-special-label">已编排技能</div>
      <div className="dsh-skill-chip-row muted">{team.skills.map(skill => <span key={skill}>{skill}</span>)}</div>
      <button type="button" className="dsh-skill-outline-button" onClick={() => { window.alert(`“${team.name}”的正式编排与执行能力将在下一阶段接入。`) }}>查看工作流</button>
    </article>)}
  </div>
}

function Connectors() {
  const [connected, setConnected] = useState<Set<string>>(() => new Set())
  return <div className="dsh-skill-special-grid">
    {CONNECTORS.map(connector => <article className="dsh-skill-special-card connector" key={connector.id}>
      <div className="dsh-skill-special-icon" style={{ background: connector.accent }}>{connector.icon}</div>
      <div className="dsh-skill-special-head"><h2>{connector.name}</h2><span>{connector.scope}</span></div>
      <p>{connector.summary}</p>
      <div className="dsh-skill-connector-foot">
        <small>{connected.has(connector.id) ? '已保存接入申请，等待授权' : '连接后仅在授权范围内访问数据'}</small>
        <button type="button" className={connected.has(connector.id) ? 'installed' : ''} onClick={() => { setConnected(current => new Set(current).add(connector.id)) }}>{connected.has(connector.id) ? '已申请' : '申请接入'}</button>
      </div>
    </article>)}
  </div>
}

function Automations() {
  return <div className="dsh-skill-special-grid">
    {AUTOMATIONS.map(item => <article className="dsh-skill-special-card automation" key={item.id}>
      <div className="dsh-skill-special-icon" style={{ background: item.accent }}>自</div>
      <div className="dsh-skill-special-head"><h2>{item.name}</h2><span>{item.trigger}</span></div>
      <p>{item.summary}</p>
      <ol className="dsh-automation-steps">{item.steps.map((step, index) => <li key={step}><b>{index + 1}</b>{step}</li>)}</ol>
      <button type="button" className="dsh-skill-outline-button" onClick={() => { window.alert(`“${item.name}”当前为预览模板；正式定时执行将在连接器授权后开放。`) }}>查看流程</button>
    </article>)}
  </div>
}

function SkillMarketplace(_props: OverlayProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(L.all)
  const [activeSubTab, setActiveSubTab] = useState('recommend')
  const [section, setSection] = useState<MarketplaceSection>('skills')
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)
  const [showInstalledOnly, setShowInstalledOnly] = useState(false)
  const [installMessage, setInstallMessage] = useState<string | null>(null)
  const [customSkills, setCustomSkills] = useState<Skill[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('dsh.marketplace.custom-skills') ?? '[]') as Skill[]
    } catch {
      return []
    }
  })
  const [adding, setAdding] = useState(false)
  const [newSkill, setNewSkill] = useState({ name: '', summary: '', category: '办公文档' })

  const [installed, setInstalled] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('dsh.mock.skills') ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })

  useEffect(() => skillMarketplaceController.subscribe((next) => {
    setOpen(next)
    if (!next) {
      setView('list')
      setSelectedSkill(null)
    }
  }), [])

  // The marketplace deliberately leaves the sidebar usable.  Selecting any
  // sidebar command should therefore also leave this overlay immediately;
  // operators should not have to find the return arrow first.
  useEffect(() => {
    if (!open) return
    const closeForSidebarAction = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('.dsh-skill-market-panel') === null) {
        skillMarketplaceController.close()
      }
    }
    document.addEventListener('pointerdown', closeForSidebarAction, true)
    return () => { document.removeEventListener('pointerdown', closeForSidebarAction, true) }
  }, [open])

  const allSkills = useMemo(() => [...customSkills, ...MOCK_SKILLS], [customSkills])
  const featuredPool = useMemo(() => allSkills.filter(s => s.featured), [allSkills])
  const [featuredOffset, setFeaturedOffset] = useState(0)
  const featuredSkills = useMemo(() => {
    if (featuredPool.length <= 3) return featuredPool
    const start = featuredOffset % featuredPool.length
    return [0, 1, 2]
      .map(i => featuredPool[(start + i) % featuredPool.length])
      .filter((skill): skill is Skill => skill !== undefined)
  }, [featuredPool, featuredOffset])

  const visible = useMemo(() => {
    let skills = [...allSkills]
    if (activeSubTab === 'skillHub') {
      skills = skills.filter(s => s.tags.includes('SkillHub'))
    } else if (activeSubTab === 'suite') {
      skills = skills.filter(s => s.tags.includes(L.suite))
    }
    if (category !== L.all) {
      skills = skills.filter(s => s.category === category)
    }
    if (query.trim() !== '') {
      const q = query.trim().toLowerCase()
      skills = skills.filter(s => `${s.name} ${s.summary} ${s.category}`.toLowerCase().includes(q))
    }
    if (showInstalledOnly) {
      skills = skills.filter(s => installed.has(s.id))
    }
    return skills
  }, [activeSubTab, allSkills, category, query, showInstalledOnly, installed])

  if (!open) return null

  const closeMarket = () => { setOpen(false); skillMarketplaceController.close() }

  const toggleInstall = async (skill: Skill) => {
    const slug = skillSlug(skill)
    try {
      if (installed.has(skill.id)) {
        await desktopInvoke('uninstall_marketplace_skill', { slug })
      } else {
        await desktopInvoke('install_marketplace_skill', {
          skill: { slug, description: skill.summary, content: skillContent(skill) },
        })
      }
    } catch (error) {
      setInstallMessage(error instanceof Error ? error.message : '技能安装失败')
      return
    }
    const next = new Set(installed)
    if (next.has(skill.id)) next.delete(skill.id)
    else next.add(skill.id)
    setInstalled(next)
    localStorage.setItem('dsh.mock.skills', JSON.stringify([...next]))
    setInstallMessage(next.has(skill.id)
      ? `已安装。新建对话后可输入 /${slug} 调用该技能。`
      : '技能已从本机移除。')
  }

  const createSkill = () => {
    const name = newSkill.name.trim()
    if (name === '') return
    const id = `local-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || Date.now()}`
    const skill: Skill = {
      id,
      name,
      category: newSkill.category,
      tags: ['本地'],
      summary: newSkill.summary.trim() || '本地添加的自定义技能。',
      description: newSkill.summary.trim() || '此技能保存在当前客户端，可预览、安装和在“我安装的”中管理。',
      installs: '0',
      accent: '#2563eb',
      icon: '自',
      version: '1.0.0',
      author: '当前用户',
    }
    const next = [skill, ...customSkills.filter(item => item.id !== id)]
    setCustomSkills(next)
    localStorage.setItem('dsh.marketplace.custom-skills', JSON.stringify(next))
    setAdding(false)
    setNewSkill({ name: '', summary: '', category: '办公文档' })
    setSelectedSkill(skill)
    setView('detail')
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
              <span className="dsh-skill-kicker">ZJUGIS HARNESS</span>
              <h1>{L.title}</h1>
              <p>{L.subtitle}</p>
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
            installed={installed.has(selectedSkill.id)}
            onToggleInstall={() => void toggleInstall(selectedSkill)}
          />
        ) : (
          <>
            <div className="dsh-skill-product-tabs" role="tablist" aria-label="技能广场功能">
              {([
                ['skills', L.skills], ['experts', L.experts], ['connectors', L.connectors], ['automations', L.automations],
              ] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={section === id} className={section === id ? 'active' : ''} onClick={() => { setSection(id); setView('list') }}>{label}</button>)}
            </div>
            {section === 'experts' && <ExpertTeams />}
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
                      className={showInstalledOnly ? 'active' : ''}
                      onClick={() => { setShowInstalledOnly(value => !value) }}
                    >
                      {L.myInstalled}
                    </button>
                    <button type="button" className="primary" onClick={() => { setAdding(true) }}>{L.addSkill}</button>
                  </div>
                </div>
              </div>

              {featuredSkills.length > 0 && (
                <div className="dsh-skill-featured-section">
                  <div className="dsh-skill-section-header">
                    <h2>{L.featured}</h2>
                    <button type="button" className="dsh-skill-refresh" onClick={() => { setFeaturedOffset(offset => offset + 3) }}>
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
                        <div className="dsh-skill-featured-icon" style={{ background: skill.accent }}>
                          {skill.icon}
                        </div>
                        <div className="dsh-skill-featured-body">
                          <h3>{skill.name}</h3>
                          <p>{skill.summary}</p>
                        </div>
                        <button
                          type="button"
                          className={installed.has(skill.id) ? 'installed' : ''}
                          onClick={(e) => { e.stopPropagation(); void toggleInstall(skill) }}
                        >
                          {installed.has(skill.id) ? <CheckIcon /> : <PlusIcon />}
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              <div className="dsh-skill-sub-tabs">
                {SUB_TABS.map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    className={activeSubTab === tab.id ? 'active' : ''}
                    onClick={() => { setActiveSubTab(tab.id) }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="dsh-skill-categories">
                {CATEGORIES.map(item => (
                  <button
                    key={item}
                    type="button"
                    className={item === category ? 'active' : ''}
                    onClick={() => { setCategory(item) }}
                  >
                    {item}
                  </button>
                ))}
              </div>

              <div className="dsh-skill-grid">
                {visible.map(skill => (
                  <article
                    key={skill.id}
                    className="dsh-skill-card"
                    onClick={() => { openDetail(skill) }}
                  >
                    <div className="dsh-skill-card-icon" style={{ background: skill.accent }}>
                      {skill.icon}
                    </div>
                    <div className="dsh-skill-card-body">
                      <div className="dsh-skill-card-meta">
                        <span>{skill.category}</span>
                        <small>{skill.installs} {L.count}</small>
                      </div>
                      <h2>{skill.name}</h2>
                      <p>{skill.summary}</p>
                    </div>
                  </article>
                ))}
              </div>

              {visible.length === 0 && <div className="dsh-skill-empty">{L.empty}</div>}
              {installMessage !== null && (
                <div className="dsh-skill-install-message" role="status">
                  {installMessage}
                  <button type="button" onClick={() => { setInstallMessage(null) }}>×</button>
                </div>
              )}
            </>}
          </>
        )}
        {adding && (
          <div className="dsh-skill-add-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAdding(false) }}>
            <form className="dsh-skill-add-dialog" onSubmit={(event) => { event.preventDefault(); createSkill() }}>
              <div>
                <h2>{L.createSkill}</h2>
                <button type="button" onClick={() => { setAdding(false) }} aria-label="关闭">×</button>
              </div>
              <label>技能名称<input autoFocus value={newSkill.name} onChange={(event) => { setNewSkill({ ...newSkill, name: event.target.value }) }} placeholder="例如：会议纪要整理" /></label>
              <label>
                分类
                <select
                  value={newSkill.category}
                  onChange={(event) => { setNewSkill({ ...newSkill, category: event.target.value }) }}
                >
                  {CATEGORIES.slice(1).map(item => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label>用途说明<textarea value={newSkill.summary} onChange={(event) => { setNewSkill({ ...newSkill, summary: event.target.value }) }} placeholder="说明这个技能何时使用、能完成什么任务" /></label>
              <footer><button type="button" onClick={() => { setAdding(false) }}>取消</button><button type="submit" disabled={newSkill.name.trim() === ''}>添加并预览</button></footer>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

function SkillMarketplaceAction({ wide }: ActionProps) {
  return (
    <button
      type="button"
      className={`dsh-skill-market-action${wide ? '' : ' rail'}`}
      aria-label={L.action}
      onClick={() => { skillMarketplaceController.open() }}
    >
      <SparkleIcon />
      {wide && <span>{L.action}</span>}
    </button>
  )
}

export const inject = ['slots']
export function apply(ctx: ClientContext): void {
  const marketplaceUrl = (process.env.DSH_CLIENT_SKILL_MARKETPLACE_URL ?? 'https://skills.zjugis.com/').trim()
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      { name: 'sidebar.footer.action', id: 'skill-marketplace', order: 10 },
      SkillMarketplaceAction,
    ),
  )
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'skill-marketplace', order: 100, inject: () => ({ marketplaceUrl }) },
      SkillMarketplace,
    ),
  )
}
