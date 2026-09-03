import { useEffect, useMemo, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { OFFICIAL_SKILLS } from './official-skills.generated.ts'
import './marketplace.css'

type SkillParam = { name: string; type: string; required: boolean; description: string; defaultValue?: string }
type Skill = {
  id: string
  name: string
  category: string
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
}

type MarketplaceInstallState = 'notInstalled' | 'installed' | 'updateAvailable' | 'conflict'
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
  brand: ConnectorBrand
  capabilities: readonly string[]
  access: string
}

type ConnectorBrand = 'zjDingtalk' | 'qqMail' | 'feishu' | 'tencentDocs' | 'tencentMeeting' | 'wecom' | 'officeMail' | 'internalMail' | 'documentCenter' | 'custom'

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
  experts: '专家市场',
  connectors: '连接器',
  automations: '自动化',
}

const SECTION_COPY: Record<MarketplaceSection, { title: string; subtitle: string }> = {
  skills: { title: L.title, subtitle: L.subtitle },
  experts: { title: L.experts, subtitle: '为自然资源与政企协同场景匹配专业智能角色' },
  connectors: { title: L.connectors, subtitle: '管理已授权的政务协同与数据服务连接' },
  automations: { title: L.automations, subtitle: '配置定时执行、事件触发和自动交付流程' },
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
  ...OFFICIAL_SKILLS,
  { id: 'contract-draft', name: '规划合同起草', category: '专业写作', tags: ['SkillHub'], summary: '起草规划编制合同（规划编制/咨询/测绘/技术服务），支持“写一份合同”等场景。', description: '按规划行业惯例生成合同草案，覆盖工作范围、成果交付、付款节点与违约责任条款，并提示风险点。', installs: '255', accent: '#f59e0b', icon: '合', version: '1.1.0', author: '专业写作室' },
  { id: 'research-report', name: '咨询报告生成器', category: '专业写作', tags: ['推荐'], summary: '生成研究、规划、政府服务和项目汇报中的结构化咨询报告。', description: '面向一类完整的项目任务：研究一个行业、分析一项政策、准备一次汇报，输出逻辑清楚、结构完整的咨询报告。', installs: '261', accent: '#6366f1', icon: '报', version: '1.7.0', author: '专业写作室' },
  { id: 'text-extract', name: '文本结构化提取', category: '专业写作', tags: ['SkillHub'], summary: '从非结构化文本中提取结构化数据的通用工作流，由用户定义字段。', description: '调用 extract_structured_data 工具完成提取，内置字段定义、抽样校验与结果导出流程。', installs: '36', accent: '#3b82f6', icon: '提', version: '1.0.2', author: '专业写作室' },
  { id: 'template-imitation', name: '模板仿写生成', category: '专业写作', tags: ['SkillHub'], summary: '按用户提供的模板文件和参考资料，仿写生成 Word 格式文档。', description: '触发场景：用户提供“模板”+“参考资料/素材”，要求“按此模板”生成文档；保持模板版式与章节结构，填充新内容。', installs: '36', accent: '#3b82f6', icon: '仿', version: '1.0.0', author: '专业写作室' },
]

const EXPERT_TEAMS: readonly ExpertTeam[] = [
  { id: 'planning-review', name: '国土空间规划审查专家团', summary: '由政策解读、GIS 制图、文本审查与报告交付技能协同完成规划材料审查。', members: ['规划主理人', '政策分析师', 'GIS 工程师', '报告审核员'], skills: ['政策文件解析', 'GIS 制图导出', '咨询报告生成器'], accent: '#2563eb' },
  { id: 'land-approval', name: '建设项目用地报批专家团', summary: '围绕选址、用地合规、报批材料与风险核验组织分工，帮助完善项目用地报批材料。', members: ['用地顾问', '政策专员', '材料审核员'], skills: ['政策文件解析', '文本结构化提取', '公文写作助手'], accent: '#7c3aed' },
  { id: 'survey-quality', name: '国土调查成果质检专家团', summary: '由空间分析、数据质检和成果编制角色协同核查调查成果，形成问题清单和交付说明。', members: ['调查工程师', 'GIS 分析师', '成果质检员'], skills: ['GIS 图层合并', '数据清洗诊断', 'GIS 制图导出'], accent: '#059669' },
  { id: 'ecology-review', name: '生态保护修复论证专家团', summary: '将生态底图分析、政策约束识别与论证材料整理串联为项目论证工作流。', members: ['生态规划师', '空间分析师', '论证撰稿人'], skills: ['政策文件解析', '空间计量经济学', '咨询报告生成器'], accent: '#0ea5e9' },
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
]

const CONNECTORS: readonly Connector[] = [
  { id: 'zj-dingtalk', name: '浙政钉', summary: '接入组织通讯录、待办与消息通知，将任务结果送达政务协同入口。', scope: '政务协同', accent: '#1677ff', brand: 'zjDingtalk', capabilities: ['待办推送', '组织通讯录', '消息通知'], access: '需由单位管理员完成组织授权' },
  { id: 'qq-mail', name: 'QQ 邮箱', summary: '在授权邮箱内检索邮件、形成摘要，并将结果保存为待发送草稿。', scope: '邮箱协作', accent: '#f5a700', brand: 'qqMail', capabilities: ['邮件检索', '摘要提炼', '草稿交付'], access: '按邮箱账号授权，可随时取消' },
  { id: 'feishu', name: '飞书', summary: '协助整理飞书文档、群消息和待办信息，支持将成果回写到协作空间。', scope: '团队协作', accent: '#00aeef', brand: 'feishu', capabilities: ['云文档', '群消息', '待办同步'], access: '仅访问你选择的工作空间内容' },
  { id: 'tencent-docs', name: '腾讯文档', summary: '读取和整理在线文档、表格与收集表，适合多人协作的材料汇编。', scope: '在线文档', accent: '#00a6ff', brand: 'tencentDocs', capabilities: ['文档读取', '表格整理', '协作交付'], access: '通过个人授权访问指定文档' },
  { id: 'tencent-meeting', name: '腾讯会议', summary: '汇总会议日程与会议纪要，帮助将任务提醒推送给参会相关人员。', scope: '会议协同', accent: '#2f7cf6', brand: 'tencentMeeting', capabilities: ['会议日程', '纪要整理', '提醒推送'], access: '需要会议组织者或个人账号授权' },
  { id: 'wecom', name: '企业微信', summary: '连接企业微信的消息、日程和审批通知，为内部协同提供统一入口。', scope: '内部协同', accent: '#2d8cf0', brand: 'wecom', capabilities: ['消息提醒', '审批通知', '日程同步'], access: '由企业管理员配置可用范围' },
  { id: 'office-mail', name: '办公邮箱', summary: '读取和起草授权范围内的办公邮件，支持将审阅结果作为邮件草稿交付。', scope: '办公邮件', accent: '#0f766e', brand: 'officeMail', capabilities: ['邮件读取', '草稿起草', '附件摘要'], access: 'OAuth 授权，不保存账号密码' },
  { id: 'internal-mail', name: '内部邮箱', summary: '适配内网 SMTP 或 Exchange 环境，专用于不出网的邮件通知与归档。', scope: '内网邮件', accent: '#7c3aed', brand: 'internalMail', capabilities: ['内网投递', '通知归档', '审批抄送'], access: '需管理员配置内网服务地址' },
  { id: 'doc-center', name: '政务文档中心', summary: '连接受控文档库，在授予的目录范围内检索、读取和提交交付物。', scope: '政务资料', accent: '#b45309', brand: 'documentCenter', capabilities: ['目录检索', '受控下载', '成果提交'], access: '按目录及文档权限控制访问' },
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
  return <SparkleIcon />
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
  subscribe(listener: (state: { open: boolean }) => void): () => void
}

function createController(): Controller {
  const listeners = new Set<(state: { open: boolean }) => void>()
  const controller: Controller = {
    open: () => { listeners.forEach((listener) => { listener({ open: true }) }) },
    close: () => { listeners.forEach((listener) => { listener({ open: false }) }) },
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

type OverlayProps = PropsRuntime<'shell.overlay'> & { marketplaceUrl: string }
type ActionProps = PropsRuntime<'sidebar.footer.action'> & SidebarFooterActionOwnerProps

function SkillDetail({ skill, onBack, installState, installing, onToggleInstall }: {
  skill: Skill
  onBack: () => void
  installState: MarketplaceInstallState
  installing: boolean
  onToggleInstall: () => void
}) {
  const installed = installState === 'installed'
  const installLabel = skill.installable !== true
    ? '演示技能，暂未开放安装'
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
          disabled={installing || skill.installable !== true || installState === 'conflict'}
        >
          {installing ? '处理中…' : installLabel}
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

/* oxlint-disable @stylistic/arrow-parens, @stylistic/max-len, typescript/no-confusing-void-expression -- compact local-only interaction trees keep cards and dialogs together. */
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
  const categories = ['全部', '规划编制', '用地报批', '政策法规', '空间分析', '调查监测', '生态保护', '政务协同']
  const visibleExperts = category === '全部' ? EXPERTS : EXPERTS.filter(expert => expert.category === category)
  const openExpert = (expert: Expert) => setSelected({ name: expert.name, role: expert.role, summary: expert.summary, tags: expert.tags, examples: expert.examples, accent: expert.accent })
  const openTeam = (team: ExpertTeam) => setSelected({ name: team.name, role: '多角色协同工作流', summary: team.summary, tags: team.members, examples: ['根据当前工作区资料启动该专家团审查', '为该专家团补充本项目的交付要求'], accent: team.accent, members: team.members, skills: team.skills })
  return <section className="dsh-expert-market">
    <nav className="dsh-expert-tabs" aria-label="专家市场内容"><button type="button" className={tab === 'experts' ? 'active' : ''} onClick={() => setTab('experts')}>专家</button><button type="button" className={tab === 'teams' ? 'active' : ''} onClick={() => setTab('teams')}>专家团</button></nav>
    {tab === 'experts' && <><div className="dsh-expert-category-row">{categories.map(item => <button type="button" key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div><div className="dsh-expert-grid">{visibleExperts.map(expert => <button type="button" className="dsh-expert-card" key={expert.id} onClick={() => openExpert(expert)}><span className="dsh-expert-avatar" style={{ background: `${expert.accent}18`, color: expert.accent }}><ExpertAvatar expert={expert} /></span><div><strong>{expert.name}</strong><small>{expert.role}</small></div><p>{expert.summary}</p><footer>{expert.tags.map(tag => <b key={tag}>{tag}</b>)}</footer></button>)}</div></>}
    {tab === 'teams' && <div className="dsh-expert-grid teams">{EXPERT_TEAMS.map(team => <button type="button" className="dsh-expert-card" key={team.id} onClick={() => openTeam(team)}><span className="dsh-expert-avatar" style={{ background: `${team.accent}18`, color: team.accent }}><MarketplaceSectionIcon section="experts" size={25} /></span><div><strong>{team.name}</strong><small>多角色协同工作流</small></div><p>{team.summary}</p><footer>{team.members.slice(0, 3).map(member => <b key={member}>{member}</b>)}<b>+{team.members.length}</b></footer></button>)}</div>}
    {selected !== null && <div className="dsh-expert-modal-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) setSelected(null) }}><section className="dsh-expert-detail" aria-label={`${selected.name}详情`}><header><div><span style={{ background: `${selected.accent}18`, color: selected.accent }}><MarketplaceSectionIcon section="experts" size={24} /></span><div><h2>{selected.name}</h2><p>{selected.role}</p></div></div><button type="button" onClick={() => setSelected(null)} aria-label="关闭">×</button></header><p className="dsh-expert-detail-summary">{selected.summary}</p><div className="dsh-expert-detail-block"><span>{selected.members === undefined ? '专业方向' : '协作角色'}</span><div>{selected.tags.map(tag => <b key={tag}>{tag}</b>)}</div></div>{selected.skills !== undefined && <div className="dsh-expert-detail-block"><span>编排技能</span><div>{selected.skills.map(skill => <b key={skill}>{skill}</b>)}</div></div>}<div className="dsh-expert-detail-block examples"><span>可以这样开始</span>{selected.examples.map(example => <p key={example}>“{example}”</p>)}</div><footer><small>当前为专家市场演示，不会启动实际多 Agent 协作。</small><button type="button" onClick={() => window.alert(`已为“${selected.name}”准备演示任务草稿。`)}>创建演示任务</button></footer></section></div>}
  </section>
}

/** Brand-styled, bundled marks keep the connector directory recognisable when offline. */
function ConnectorBrandIcon({ brand, accent }: { brand: ConnectorBrand; accent: string }) {
  const common = { width: 38, height: 38, viewBox: '0 0 40 40', fill: 'none', 'aria-hidden': true }
  if (brand === 'qqMail') return <svg {...common}><circle cx="20" cy="20" r="18" fill="#ffb400" /><path d="M10 13h20v15H10z" fill="#fff" /><path d="m11 14 9 7 9-7" stroke="#e89600" strokeWidth="2.4" strokeLinejoin="round" /></svg>
  if (brand === 'feishu') return <svg {...common}><path d="M7 14c6-7 12-9 18-6l7 6-6 17-15-1-4-9Z" fill="#25c3ff" /><path d="M7 14c5 0 9 2 12 6l-8 10-4-9Z" fill="#00b96b" /><path d="M19 20c4-1 8 0 13 3l-6 8-15-1 8-10Z" fill="#6c55ff" /><circle cx="22" cy="15" r="2" fill="#fff" /></svg>
  if (brand === 'tencentDocs') return <svg {...common}><rect x="5" y="4" width="30" height="32" rx="8" fill="#0aa6f7" /><path d="M13 10h13v4H13zm0 8h13v4H13zm0 8h8v4h-8z" fill="#fff" /><path d="M29 23h4v7h-4z" fill="#56d9cd" /></svg>
  if (brand === 'tencentMeeting') return <svg {...common}><rect x="4" y="4" width="32" height="32" rx="10" fill="#2f7cf6" /><path d="m11 15 5 5 4-4 4 4 5-5v11H11V15Z" fill="#fff" /><path d="M20 16v10" stroke="#c8ddff" strokeWidth="2" /></svg>
  if (brand === 'wecom') return <svg {...common}><path d="M7 15c0-5 5-9 11-9s11 4 11 9-5 9-11 9c-1 0-2 0-3-.3L9 28l1.7-5C8.4 21.3 7 18.4 7 15Z" fill="#2b8bed" /><path d="M21 20c0-4.5 4.2-8 9-8 3.4 0 6.2 1.7 7.6 4.3-1 4.2-4.8 7.2-9.6 7.2-1.1 0-2.1-.2-3-.5L21 25l.8-3.2c-.5-.6-.8-1.2-.8-1.8Z" fill="#32c48d" transform="translate(-3 2)" /><circle cx="15" cy="15" r="1.6" fill="#fff" /><circle cx="21" cy="15" r="1.6" fill="#fff" /></svg>
  if (brand === 'zjDingtalk') return <svg {...common}><defs><linearGradient id="zj-ding" x1="7" y1="5" x2="33" y2="35" gradientUnits="userSpaceOnUse"><stop stopColor="#176cff" /><stop offset="1" stopColor="#4ba6ff" /></linearGradient></defs><rect x="4" y="4" width="32" height="32" rx="10" fill="url(#zj-ding)" /><path d="M10 16c4-5 10-7 19-6-4 1-6 3-8 5 3 0 5 1 7 3-6 5-13 7-20 5 2-2 3-4 4-6-2 0-4 0-6-1Z" fill="#fff" /><circle cx="28" cy="10" r="2" fill="#ffcf47" /></svg>
  if (brand === 'officeMail') return <svg {...common}><rect x="4" y="6" width="32" height="28" rx="8" fill="#0f766e" /><path d="M10 13h20v15H10z" fill="#fff" /><path d="m11 14 9 7 9-7" stroke="#0f766e" strokeWidth="2.4" strokeLinejoin="round" /></svg>
  if (brand === 'internalMail') return <svg {...common}><rect x="4" y="6" width="32" height="28" rx="8" fill="#7c3aed" /><path d="M10 13h20v15H10z" fill="#fff" /><path d="m11 14 9 7 9-7" stroke="#7c3aed" strokeWidth="2.4" strokeLinejoin="round" /><path d="M27 23v5h-7v-5a3.5 3.5 0 1 1 7 0Z" fill="#e7dcff" /></svg>
  if (brand === 'documentCenter') return <svg {...common}><path d="M7 9h10l3 3h13v19H7z" fill="#b45309" /><path d="M13 17h14M13 22h14M13 27h9" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" /></svg>
  return <svg {...common}><rect x="5" y="5" width="30" height="30" rx="9" fill={accent} /><path d="M13 20h14M20 13v14" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" /></svg>
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
    const connector = { id: `custom-${Date.now()}`, name, summary: customDescription.trim() || '这是一个保存在本机演示列表中的自定义连接器。', scope: customCategory, accent: '#4969d8', brand: 'custom' as const, capabilities: ['连接说明', '访问范围', '使用提醒'], access: '演示阶段不会发起网络连接或保存凭据' }
    setCustomConnectors(items => [connector, ...items])
    setCustomName('')
    setCustomDescription('')
    setShowCustom(false)
    setSelected(connector)
  }
  return <section className="dsh-connectors-page">
    <div className="dsh-connectors-toolbar"><span>选择服务后查看可访问的数据范围与使用方式。</span><button type="button" onClick={() => setShowCustom(true)}><PlusIcon /> 自定义连接器</button></div>
    <div className="dsh-connectors-grid">
      {connectors.map(connector => <button type="button" className="dsh-connector-card" key={connector.id} onClick={() => setSelected(connector)}>
        <div className="dsh-connector-card-top"><ConnectorBrandIcon brand={connector.brand} accent={connector.accent} /><span>{connector.scope}</span></div>
        <strong>{connector.name}</strong><p>{connector.summary}</p>
        <small>{requested.has(connector.id) ? '已保存申请' : '点击查看接入详情'}</small><i aria-hidden="true">›</i>
      </button>)}
    </div>
    {selected !== null && <div className="dsh-connector-modal-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) setSelected(null) }}><section className="dsh-connector-detail" aria-label={`${selected.name}连接器详情`}><header><div><ConnectorBrandIcon brand={selected.brand} accent={selected.accent} /><div><h2>{selected.name}</h2><p>{selected.scope} · 本地演示目录</p></div></div><button type="button" onClick={() => setSelected(null)} aria-label="关闭">×</button></header><p className="dsh-connector-detail-summary">{selected.summary}</p><div className="dsh-connector-detail-block"><span>可协助完成</span><div>{selected.capabilities.map(item => <b key={item}>{item}</b>)}</div></div><div className="dsh-connector-detail-block"><span>接入说明</span><p>{selected.access}</p></div><footer><small>接入后仅在授权范围内访问数据。</small><button type="button" className={requested.has(selected.id) ? 'requested' : ''} onClick={() => requestAccess(selected)}>{requested.has(selected.id) ? '已提交申请' : '申请接入'}</button></footer></section></div>}
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
/* oxlint-enable @stylistic/arrow-parens, @stylistic/max-len, typescript/no-confusing-void-expression */

function SkillMarketplace({ section }: OverlayProps & { section: MarketplaceSection }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(L.all)
  const [activeSubTab, setActiveSubTab] = useState('recommend')
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)
  const [showInstalledOnly, setShowInstalledOnly] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [installMessage, setInstallMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [customSkills, setCustomSkills] = useState<Skill[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('dsh.marketplace.custom-skills') ?? '[]') as Skill[]
    } catch {
      return []
    }
  })
  const [adding, setAdding] = useState(false)
  const [newSkill, setNewSkill] = useState({ name: '', summary: '', category: '办公文档' })

  const [installStates, setInstallStates] = useState<Map<string, MarketplaceSkillState>>(new Map())
  const installed = useMemo(() => new Set([...installStates.values()]
    .filter(value => value.state === 'installed' || value.state === 'updateAvailable')
    .map(value => value.id)), [installStates])

  const refreshInstallStates = async () => {
    try {
      const value = await desktopInvoke('list_marketplace_skills', {})
      if (!Array.isArray(value)) return
      const states = value.filter((item): item is MarketplaceSkillState => {
        if (typeof item !== 'object' || item === null) return false
        const candidate = item as Partial<MarketplaceSkillState>
        return typeof candidate.id === 'string' && typeof candidate.slug === 'string'
          && typeof candidate.version === 'string' && typeof candidate.state === 'string'
      })
      setInstallStates(new Map(states.map(state => [state.id, state])))
    } catch {
      // Browser previews have no native bridge; installation remains unavailable there.
    }
  }

  useEffect(() => marketplaceControllers[section].subscribe((next) => {
    setOpen(next.open)
    if (next.open && section === 'skills') void refreshInstallStates()
    if (!next.open) {
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
        marketplaceControllers[section].close()
      }
    }
    document.addEventListener('pointerdown', closeForSidebarAction, true)
    return () => { document.removeEventListener('pointerdown', closeForSidebarAction, true) }
  }, [open])

  const allSkills = useMemo(() => [...customSkills, ...MOCK_SKILLS], [customSkills])
  const featuredPool = useMemo(() => allSkills
    .filter(skill => skill.featured)
    .sort((left, right) => Number(right.tags.includes('官方')) - Number(left.tags.includes('官方'))), [allSkills])
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

  const closeMarket = () => { setOpen(false); marketplaceControllers[section].close() }

  const toggleInstall = async (skill: Skill) => {
    if (installing !== null) return
    if (skill.installable !== true) {
      setInstallMessage({ kind: 'error', text: '该条目是演示技能，暂未提供可安装的正式技能包。' })
      return
    }
    const slug = skillSlug(skill)
    const currentState = installStates.get(skill.id)?.state ?? 'notInstalled'
    setInstallMessage(null)
    setInstalling(skill.id)
    let installedPath: unknown
    try {
      if (currentState === 'installed') {
        await desktopInvoke('uninstall_marketplace_skill', { slug })
      } else {
        installedPath = await desktopInvoke('install_marketplace_skill', { slug })
      }
    } catch (error) {
      setInstallMessage({ kind: 'error', text: error instanceof Error ? error.message : '技能安装失败' })
      return
    } finally {
      setInstalling(null)
    }
    const nowInstalled = currentState !== 'installed'
    await refreshInstallStates()
    setInstallMessage(nowInstalled
      ? { kind: 'success', text: `已安装到 ${typeof installedPath === 'string' ? installedPath : `~/.dsh/skills/${slug}/SKILL.md`}。新建对话后可输入 /${slug} 调用。` }
      : { kind: 'success', text: '技能已从本机移除。' })
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
      description: newSkill.summary.trim() || '此技能保存在当前客户端，可预览并在本地列表中管理。正式安装包功能暂未开放。',
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
            installState={installStates.get(selectedSkill.id)?.state ?? 'notInstalled'}
            installing={installing === selectedSkill.id}
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
                          disabled={installing === skill.id || skill.installable !== true || installStates.get(skill.id)?.state === 'conflict'}
                          title={skill.installable === true ? undefined : '演示技能暂未开放安装'}
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
            </>}
          </>
        )}
        {installMessage !== null && (
          <div className={`dsh-skill-install-message ${installMessage.kind}`} role="status">
            {installMessage.text}
            <button type="button" onClick={() => { setInstallMessage(null) }}>×</button>
          </div>
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

function SkillMarketplaceAction({ wide, section = 'skills' }: ActionProps & { section?: MarketplaceSection }) {
  const labels: Record<MarketplaceSection, string> = {
    skills: L.action,
    experts: L.experts,
    connectors: L.connectors,
    automations: L.automations,
  }
  return (
    <button
      type="button"
      className={`dsh-skill-market-action${wide ? '' : ' rail'}`}
      aria-label={labels[section]}
      onClick={() => { marketplaceControllers[section].open() }}
    >
      <MarketplaceSectionIcon section={section} size={wide ? 16 : 18} />
      {wide && <span>{labels[section]}</span>}
    </button>
  )
}

export const inject = ['slots']
export function apply(ctx: ClientContext): void {
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
        { name: 'shell.overlay', id: `skill-marketplace-${section}`, order: 100 + index, inject: () => ({ marketplaceUrl, section }) },
        SkillMarketplace,
      ),
    )
  }
}
