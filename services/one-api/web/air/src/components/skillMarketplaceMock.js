/**
 * 技能广场对齐的 Mock 数据源。
 *
 * 与安装包（桌面端）技能广场 `packages/client/ui-skill-marketplace` 的
 * MOCK_SKILLS 逐条对齐：id / display_name / category / tags / summary /
 * description / downloads / version / team 完全一致，并补齐后台管理需要的
 * 上传人（submitter）、上传时间（created_at）、主要能力（capabilities）与
 * 技能包文件清单（package_files）。正式接口接入前，本文件是唯一数据源。
 *
 * package_files 供浏览抽屉组装文件夹预览：SKILL.md 由 skillDownload 的
 * buildSkillMd 现场生成，其余文件由 buildMockAssets 按 `<!-- file: path -->`
 * 标记格式生成文本，经 parseAssets 解析为可预览的文件树。
 */

/** 与技能广场一致的分类列表。 */
export const MOCK_SKILL_CATEGORIES = ['空间制图', '专业写作', '研究咨询', '办公文档', '数据分析'];

/** 上传一条记录所需的全部字段（未含 body/assets，由 normalizeMockSkill 生成）。 */
const RAW_SKILLS = [
  {
    id: 'land-evaluation', display_name: '土地评估报告', category: '空间制图', tags: ['推荐'],
    summary: '写土地评估报告，基于宗地数据与基准地价生成规范化评估文书。',
    description: '面向土地估价场景的报告生成技能，覆盖估价方法选择（市场比较法、收益还原法、剩余法等）、参数取值说明、结果校验与报告排版，输出符合行业规范的土地评估报告。',
    capabilities: ['基准地价与市场比较法取值', '估价方法选择与参数说明', '规范化报告排版输出'],
    version: '1.0.0', team: '规划测绘院', submitter: '陈立',
    created_at: '2026-06-18 10:24:00', downloads: 53, status: 'published',
    params: [{ name: 'benchmarkPrice', type: 'number', required: false, description: '所在区域基准地价（元/平方米），缺省时按最新公示地价取值' }],
    package_files: ['scripts/evaluate.py', 'references/估价参数说明.md', 'templates/报告模板.md']
  },
  {
    id: 'arcgis-plugin', display_name: 'ArcGIS插件创建', category: '空间制图', tags: ['推荐', 'SkillHub', '套件'],
    summary: '当用户要求创建、修改或打包 ArcGIS/ArcMap .esriAddIn 插件时使用。',
    description: '指导创建、修改或打包 ArcGIS/ArcMap .esriAddIn 插件与工具条，例如“帮我做一个 ArcGIS 插件/小工具”。覆盖工程结构、AddIn 配置、工具类编写与本地安装验证。',
    capabilities: ['.esriAddIn 工程结构生成', '工具条与命令类代码骨架', '本地安装与调试验证清单'],
    version: '1.2.0', team: 'GIS 工具链', submitter: '吴斌',
    created_at: '2026-04-02 09:15:00', downloads: 284, status: 'published',
    params: [{ name: 'arcgisVersion', type: 'string', required: true, description: '目标 ArcGIS Desktop 版本', default: '10.8' }],
    package_files: ['scripts/build_addin.py', 'scripts/config.esriaddinx', 'references/AddIn配置说明.md']
  },
  {
    id: 'gov-doc', display_name: '公文写作助手', category: '办公文档', tags: ['推荐'],
    summary: '中国党政机关公文写作知识库，覆盖通知、请示、报告、纪要等文种。',
    description: '当用户不知道该选哪种文种（通知/请示/报告/函/意见/决定/批复/公告/通报）、询问公文格式或需要起草公文时使用，提供文种选择、版式规范与范文参考。',
    capabilities: ['文种选择与适用范围判定', '版式与格式规范校验', '范文与常用表述参考'],
    version: '2.0.0', team: '办公助手', submitter: '林静',
    created_at: '2025-11-27 16:40:00', downloads: 262, status: 'published',
    package_files: ['references/文种对照表.md', 'references/格式规范.md', 'templates/通知模板.md']
  },
  {
    id: 'residential-judicial', display_name: '房地产住宅司法计算', category: '数据分析', tags: ['推荐'],
    summary: '用于房地产估价机构开展住宅类涉房地产司法评估时的计算与取证。',
    description: '面向司法评估场景的住宅价值计算工具，覆盖法院委托、权属登记、现场查勘、买卖与租赁案例及可检核等流程，输出可追溯的计算过程。',
    capabilities: ['司法评估流程与取证清单', '住宅价值计算与过程留痕', '可追溯计算表输出'],
    version: '1.1.0', team: '估价计算组', submitter: '何文涛',
    created_at: '2026-05-09 11:02:00', downloads: 122, status: 'published',
    package_files: ['scripts/judicial_calc.py', 'references/司法取证清单.md']
  },
  {
    id: 'residential-mortgage', display_name: '房地产住宅抵押计算', category: '数据分析', tags: ['SkillHub'],
    summary: '用于住宅房地产抵押估价，独立读取当前项目的权属、查勘与案例数据。',
    description: '读取抵押估价项目的权属、查勘、买卖案例、租赁与参数资料，取得可核验参数，完成抵押价值计算并生成过程表。',
    capabilities: ['权属与查勘数据读取', '抵押价值计算', '参数核验与过程表生成'],
    version: '1.0.2', team: '估价计算组', submitter: '秦朗',
    created_at: '2026-05-21 15:33:00', downloads: 110, status: 'draft',
    package_files: ['scripts/mortgage_calc.py', 'references/参数核验表.md']
  },
  {
    id: 'gis-merge', display_name: 'GIS图层合并', category: '空间制图', tags: ['推荐'],
    summary: '从一个或多个文件夹中找到所有 .gdb，并将指定图层合并为一个或多个图层。',
    description: '当用户要求批量合并空间数据时使用：扫描目录下的 .gdb 文件，按图层名归并要素类，处理坐标系差异与字段映射，输出合并结果。',
    capabilities: ['批量扫描目录下 .gdb', '按图层名归并要素类', '坐标系差异与字段映射处理'],
    version: '1.3.0', team: 'GIS 工具链', submitter: '何雨桐',
    created_at: '2026-03-14 13:47:00', downloads: 280, status: 'published',
    package_files: ['scripts/merge_layers.py', 'scripts/projection.py']
  },
  {
    id: 'gis-export', display_name: 'GIS制图导出', category: '空间制图', tags: ['SkillHub', '套件'],
    summary: '将 .mpk 或 .mxd 数据制图并导出为 PNG 规划图纸。',
    description: '当用户需要将工程包或地图文档批量出图时使用，仅适用于 Windows + ArcGIS Desktop 10.x 环境，支持图框整饰、比例尺与图例自动配置。',
    capabilities: ['.mpk / .mxd 批量出图', '图框整饰与比例尺配置', '图例自动布局'],
    version: '1.2.1', team: 'GIS 工具链', submitter: '吴斌',
    created_at: '2026-02-26 10:05:00', downloads: 277, status: 'published',
    package_files: ['scripts/export_map.py', 'references/出图参数.md']
  },
  {
    id: 'invoice-batch', display_name: '发票批量汇总', category: '办公文档', tags: ['推荐'],
    summary: '批量解析 PDF 发票并生成格式化 Excel 汇总表，适用于报销粘贴与台账登记。',
    description: '批量读取 PDF 发票（增值税专用/普通发票、电子发票等），提取金额、税额、开票日期与购销方信息，生成报销汇总、财务对账等场景的 Excel 台账。',
    capabilities: ['PDF 发票批量解析', '金额税额与购销方提取', '报销汇总 Excel 台账'],
    version: '1.0.4', team: '财务效率组', submitter: '蒋楠',
    created_at: '2026-07-03 09:58:00', downloads: 35, status: 'published',
    package_files: ['scripts/parse_invoice.py', 'scripts/to_excel.py', 'references/字段映射.md']
  },
  {
    id: 'data-insight', display_name: '数据分析洞察家', category: '数据分析', tags: ['推荐'],
    summary: '从 csv / xlsx / 数据库中识别规律，做分组/相关/趋势分析并生成结构化报告。',
    description: '数据集分析与洞察提取工具：自动识别字段类型，执行分组统计、相关性分析与趋势检测，输出带图表说明的结构化分析报告。',
    capabilities: ['字段类型自动识别', '分组统计与相关性分析', '趋势检测与图表化报告'],
    version: '1.1.0', team: '数据工坊', submitter: '顾晨',
    created_at: '2026-06-30 17:12:00', downloads: 36, status: 'published',
    package_files: ['scripts/analyze.py', 'scripts/report.py']
  },
  {
    id: 'data-clean', display_name: '数据清洗诊断', category: '数据分析', tags: ['SkillHub'],
    summary: '通用数据清洗与质量诊断工具，覆盖社科、自然科学及工程领域常见质量问题。',
    description: '对提交的数据文件做缺失值、异常值、重复记录与类型一致性诊断，给出清洗建议并可执行标准化清洗流程。',
    capabilities: ['缺失值与异常值诊断', '重复记录与类型一致性检查', '标准化清洗流程执行'],
    version: '1.0.6', team: '数据工坊', submitter: '沈亦然',
    created_at: '2026-04-19 14:26:00', downloads: 36, status: 'published',
    package_files: ['scripts/diagnose.py', 'scripts/clean.py']
  },
  {
    id: 'qa-table', display_name: '问卷表格匹配', category: '办公文档', tags: ['SkillHub'],
    summary: '在两张表之间做模糊文本匹配（可选）回填数据，只需查看匹配结果即可直接使用。',
    description: '按用户需求在两张工作表间做模糊匹配并回填，支持轻量模式（仅输出匹配对照）与完整模式（直接写回目标表）。',
    capabilities: ['两张表模糊文本匹配', '轻量模式输出匹配对照', '完整模式写回目标表'],
    version: '1.0.3', team: '办公助手', submitter: '赵一鸣',
    created_at: '2026-05-28 11:41:00', downloads: 37, status: 'disabled',
    package_files: ['scripts/match_tables.py', 'references/匹配阈值说明.md']
  },
  {
    id: 'word-edit', display_name: 'Word文档编辑', category: '办公文档', tags: ['推荐'],
    summary: 'Word 文档修订与结构化编辑工作流指导，支持修订追踪与批注工作流。',
    description: '触发：需要 tracked changes（修订追踪）/批注工作流，或直接编辑 .docx 结构。提供样式、目录、域与修订管理的标准操作路径。',
    capabilities: ['修订追踪与批注工作流', '样式、目录与域管理', '.docx 结构化编辑'],
    version: '1.4.0', team: '办公助手', submitter: '林静',
    created_at: '2026-07-16 10:20:00', downloads: 38, status: 'published',
    package_files: ['scripts/edit_docx.py', 'references/OOXML要点.md']
  },
  {
    id: 'ppt-demo', display_name: 'PPT演示文稿处理', category: '办公文档', tags: ['SkillHub'],
    summary: 'PPT 演示文稿创建、编辑与分析，支持内容生成、修改与主题/字体分析。',
    description: '支持 .pptx 文件的内容生成、版式修改、主题与字体分析、OOXML 原生结构操作，适用于汇报材料快速成稿。',
    capabilities: ['PPT 内容生成与版式修改', '主题与字体分析', 'OOXML 原生结构操作'],
    version: '1.2.0', team: '办公助手', submitter: '赵一鸣',
    created_at: '2026-06-05 15:09:00', downloads: 37, status: 'published',
    package_files: ['scripts/edit_pptx.py', 'references/版式速查.md']
  },
  {
    id: 'excel-table', display_name: 'Excel表格处理', category: '办公文档', tags: ['推荐'],
    summary: 'Excel 电子表格创建、编辑与可视化，支持公式、格式、图表与金融模型规范。',
    description: '触发：用户要求新建/修改 Excel 表格、编写公式、制作图表或搭建预算/测算模型。遵循表格建模规范，输出可审计的电子表格。',
    capabilities: ['公式编写与格式设置', '图表制作与可视化', '预算与测算模型搭建'],
    version: '1.5.0', team: '办公助手', submitter: '林静',
    created_at: '2026-08-11 09:33:00', downloads: 36, status: 'published',
    package_files: ['scripts/build_sheet.py', 'references/建模规范.md']
  },
  {
    id: 'questionnaire-design', display_name: '问卷量表设计', category: '研究咨询', tags: ['SkillHub'],
    summary: '问卷/量表设计工具，覆盖学术研究问卷、临床量表、市场调研与组织行为调查。',
    description: '提供题项编写、量表选择、信效度建议与排版输出，适用于学术研究、临床与市场调研场景的问卷设计。',
    capabilities: ['题项编写与量表选择', '信效度检验建议', '问卷排版与输出'],
    version: '1.0.5', team: '研究咨询所', submitter: '苏牧',
    created_at: '2026-03-27 16:18:00', downloads: 35, status: 'published',
    package_files: ['references/量表库.md', 'templates/问卷模板.md']
  },
  {
    id: 'feasibility', display_name: '可行性研究报告', category: '研究咨询', tags: ['推荐'],
    summary: '起草和审查中国政府投资项目可行性研究报告（可研报告）。',
    description: '当用户要“写可研”、“可行性研究”、“项目立项报告”时使用，按发改部门规范组织章节、投资估算与经济评价内容。',
    capabilities: ['可研章节结构编排', '投资估算与经济评价', '发改部门规范条款核对'],
    version: '2.1.0', team: '研究咨询所', submitter: '郑晓琳',
    created_at: '2026-01-22 13:55:00', downloads: 282, status: 'published',
    package_files: ['references/章节大纲.md', 'references/投资估算表.md', 'templates/可研模板.md']
  },
  {
    id: 'case-compare', display_name: '规划案例比较分析', category: '研究咨询', tags: ['SkillHub'],
    summary: '“规划行业案例比较分析”，对多个城市/地区的规划实践进行结构化对比。',
    description: '覆盖国土空间规划、产业发展、城市更新、乡村建设等主题，输出案例对比矩阵与经验启示。',
    capabilities: ['多城市案例结构化对比', '主题维度拆解', '经验启示归纳'],
    version: '1.3.0', team: '研究咨询所', submitter: '苏牧',
    created_at: '2026-02-09 10:47:00', downloads: 258, status: 'published',
    package_files: ['references/对比维度.md', 'templates/对比矩阵.md']
  },
  {
    id: 'policy-analysis', display_name: '政策文件解析', category: '研究咨询', tags: ['推荐'],
    summary: '政府政策文件解析，提取结构化信息和关键要求。',
    description: '对政策原文做条款拆解，提取适用范围、主管部门、关键指标与时间节点，生成结构化政策要点卡片。',
    capabilities: ['条款拆解与要点提取', '适用范围与主管部门识别', '关键指标与时间节点结构化'],
    version: '1.6.0', team: '研究咨询所', submitter: '郑晓琳',
    created_at: '2026-07-29 14:08:00', downloads: 262, status: 'published',
    package_files: ['scripts/parse_policy.py', 'references/要素清单.md']
  },
  {
    id: 'population-forecast', display_name: '人口规模预测', category: '研究咨询', tags: ['SkillHub'],
    summary: '规划人口预测，当用户需要预测城市/地区未来人口规模时使用。',
    description: '支持综合增长率法、劳动力需求法、灰色预测 GM(1,1) 等方法，输出多方案人口规模预测结果与参数说明。',
    capabilities: ['综合增长率法测算', '劳动力需求法测算', '灰色预测 GM(1,1) 多方案输出'],
    version: '1.1.2', team: '研究咨询所', submitter: '苏牧',
    created_at: '2026-04-08 11:29:00', downloads: 250, status: 'published',
    package_files: ['scripts/forecast.py', 'references/方法参数.md']
  },
  {
    id: 'spatial-econometrics', display_name: '空间计量经济学', category: '数据分析', tags: ['SkillHub'],
    summary: '空间计量经济学工具，支持空间权重矩阵构建、Moran I / Geary C 检验。',
    description: '适用于地理/网络数据的研究分析，提供空间自相关检验、空间滞后与误差模型估计的完整流程。',
    capabilities: ['空间权重矩阵构建', 'Moran I / Geary C 检验', '空间滞后与误差模型估计'],
    version: '1.0.1', team: '数据工坊', submitter: '顾晨',
    created_at: '2026-08-20 17:41:00', downloads: 36, status: 'draft',
    package_files: ['scripts/spatial_models.py', 'references/模型选择.md']
  },
  {
    id: 'arcpy-script', display_name: 'ArcPy脚本生成', category: '空间制图', tags: ['SkillHub'],
    summary: 'ArcPy 脚本生成，当用户需要编写 ArcGIS/ArcPy 自动化脚本时使用。',
    description: '生成或调试 GIS 自动化脚本，覆盖要素分析、裁剪、投影转换、批量制图等常见 ArcPy 场景。',
    capabilities: ['要素分析与裁剪脚本', '投影转换批处理', '批量制图自动化'],
    version: '1.4.0', team: 'GIS 工具链', submitter: '何雨桐',
    created_at: '2026-05-14 09:07:00', downloads: 251, status: 'published',
    package_files: ['scripts/arcpy_tools.py', 'scripts/batch_map.py']
  },
  {
    id: 'map-coloring', display_name: '规划标准配色', category: '空间制图', tags: ['推荐'],
    summary: '规划标准配色方案，图纸与报告的标准配色，使用国土空间规划用地分类色标。',
    description: '按《国土空间规划用地用海分类》提供三调标准色标，支持图纸、图例与报告配色的统一输出。',
    capabilities: ['三调标准色标输出', '图纸与图例配色统一', '报告配色规范校验'],
    version: '1.2.0', team: '规划测绘院', submitter: '周敏',
    created_at: '2026-06-24 15:52:00', downloads: 271, status: 'published',
    package_files: ['references/色标对照表.md', 'scripts/apply_palette.py']
  },
  {
    id: 'gis-geology-analysis', display_name: '地质条件分析', category: '空间制图', tags: ['官方', '推荐'],
    summary: '调用 GIS_Service 分析指定面范围的地质灾害隐患分区与地质环境条件。',
    description: '读取当前工作区的 GeoJSON 面范围，调用地质条件分析服务并交付不可覆盖的原始分析结果。使用前必须确认输入坐标系与服务数据一致。',
    capabilities: ['GeoJSON 面范围校验与 rings 转换', '地质灾害隐患分区分析', '地质环境条件分析', '原始响应 JSON 交付'],
    version: '1.0.0', team: 'ZJUGIS GIS 服务', submitter: 'GIS 服务管理员',
    created_at: '2026-09-01 18:00:00', downloads: 0, status: 'published',
    params: [{ name: 'geoJsonFile', type: 'file', required: true, description: '包含 Polygon 或 MultiPolygon 的 GeoJSON 文件' }, { name: 'YfxFieldName', type: 'string', required: false, description: '分区名称字段', default: '分区名称' }],
    package_files: ['references/GIS_Service地质条件分析接口.md', 'templates/地质条件分析交付说明.md']
  },
  {
    id: 'gis-land-use-plan-review', display_name: '土地利用规划审查', category: '空间制图', tags: ['官方', '推荐'],
    summary: '调用 GIS_Service 对项目范围开展土地利用规划符合性审查。',
    description: '读取当前工作区的 GeoJSON 面范围，调用规划审查接口并交付不可覆盖的原始审查结果。当前服务示例审查类别 Blxsw 默认为 4。',
    capabilities: ['GeoJSON 面范围校验与 rings 转换', '规划审查接口调用', '请求参数留痕', '原始响应 JSON 交付'],
    version: '1.0.0', team: 'ZJUGIS GIS 服务', submitter: 'GIS 服务管理员',
    created_at: '2026-09-01 18:05:00', downloads: 0, status: 'published',
    params: [{ name: 'geoJsonFile', type: 'file', required: true, description: '包含 Polygon 或 MultiPolygon 的 GeoJSON 文件' }, { name: 'Blxsw', type: 'number', required: false, description: '服务审查类别编码', default: 4 }],
    package_files: ['references/GIS_Service规划审查接口.md', 'templates/土地利用规划审查交付说明.md']
  },
  {
    id: 'gis-third-survey-analysis', display_name: '三调土地利用现状分析', category: '空间制图', tags: ['官方', '推荐'],
    summary: '调用 GIS_Service 对指定面范围开展三调土地利用现状与图斑专项分析。',
    description: '读取当前工作区的 GeoJSON 面范围与三调年度，调用 SanDXzAnalysis 并交付不可覆盖的原始分析结果。',
    capabilities: ['GeoJSON 面范围校验与 rings 转换', '三调年度参数控制', '图斑专项分析开关', '原始响应 JSON 交付'],
    version: '1.0.0', team: 'ZJUGIS GIS 服务', submitter: 'GIS 服务管理员',
    created_at: '2026-09-01 18:10:00', downloads: 0, status: 'published',
    params: [{ name: 'geoJsonFile', type: 'file', required: true, description: '包含 Polygon 或 MultiPolygon 的 GeoJSON 文件' }, { name: 'Xznf', type: 'number', required: false, description: '三调现状年度', default: 2024 }],
    package_files: ['references/GIS_Service三调现状分析接口.md', 'templates/三调土地利用现状分析交付说明.md']
  },
  {
    id: 'contract-draft', display_name: '规划合同起草', category: '专业写作', tags: ['SkillHub'],
    summary: '起草规划编制合同（规划编制/咨询/测绘/技术服务），支持“写一份合同”等场景。',
    description: '按规划行业惯例生成合同草案，覆盖工作范围、成果交付、付款节点与违约责任条款，并提示风险点。',
    capabilities: ['工作范围与成果交付条款', '付款节点与违约责任', '常见风险点提示'],
    version: '1.1.0', team: '专业写作室', submitter: '韩雪',
    created_at: '2026-03-05 10:36:00', downloads: 255, status: 'published',
    package_files: ['templates/合同模板.md', 'references/条款要点.md']
  },
  {
    id: 'research-report', display_name: '咨询报告生成器', category: '专业写作', tags: ['推荐'],
    summary: '生成研究、规划、政府服务和项目汇报中的结构化咨询报告。',
    description: '面向一类完整的项目任务：研究一个行业、分析一项政策、准备一次汇报，输出逻辑清楚、结构完整的咨询报告。',
    capabilities: ['行业研究与政策分析框架', '汇报材料结构编排', '结论与建议成稿'],
    version: '1.7.0', team: '专业写作室', submitter: '谭越',
    created_at: '2026-07-08 16:23:00', downloads: 261, status: 'published',
    package_files: ['templates/报告骨架.md', 'references/论证结构.md']
  },
  {
    id: 'text-extract', display_name: '文本结构化提取', category: '专业写作', tags: ['SkillHub'],
    summary: '从非结构化文本中提取结构化数据的通用工作流，由用户定义字段。',
    description: '调用 extract_structured_data 工具完成提取，内置字段定义、抽样校验与结果导出流程。',
    capabilities: ['自定义提取字段定义', '抽样校验流程', '结构化结果导出'],
    version: '1.0.2', team: '专业写作室', submitter: '韩雪',
    created_at: '2026-05-19 09:44:00', downloads: 36, status: 'published',
    package_files: ['scripts/extract_fields.py', 'references/字段模板.md']
  },
  {
    id: 'template-imitation', display_name: '模板仿写生成', category: '专业写作', tags: ['SkillHub'],
    summary: '按用户提供的模板文件和参考资料，仿写生成 Word 格式文档。',
    description: '触发场景：用户提供“模板”+“参考资料/素材”，要求“按此模板”生成文档；保持模板版式与章节结构，填充新内容。',
    capabilities: ['模板版式与章节保持', '参考素材内容填充', 'Word 文档成稿'],
    version: '1.0.0', team: '专业写作室', submitter: '谭越',
    created_at: '2026-08-26 14:15:00', downloads: 36, status: 'draft',
    package_files: ['scripts/imitate_template.py', 'references/仿写要点.md']
  }
];

/** 参数配置表（SKILL.md 正文与参考资料共用）。 */
function paramTable(skill) {
  const params = skill.params || [];
  if (params.length === 0) return '该技能无需配置参数。';
  const rows = params.map(param => {
    const required = param.required ? '是' : '否';
    const fallback = param.default === undefined ? '—' : `\`${param.default}\``;
    return `| \`${param.name}\` | ${param.type} | ${required} | ${param.description} | ${fallback} |`;
  });
  return ['| 参数 | 类型 | 必填 | 说明 | 默认值 |', '| --- | --- | --- | --- | --- |', ...rows].join('\n');
}

/** SKILL.md 正文（frontmatter 由 buildSkillMd 现场拼接）。 */
function buildBody(skill) {
  const capabilities = (skill.capabilities || []).map(item => `- ${item}`).join('\n');
  return [
    `# ${skill.display_name}`,
    '',
    skill.description || skill.summary || '',
    '',
    '## 主要能力',
    '',
    capabilities || '（待补充）',
    '',
    '## 使用方式',
    '',
    `在对话中输入 \`/${skill.id}\` 触发；助手也可在任务匹配时自动加载本技能。`,
    '',
    '## 参数配置',
    '',
    paramTable(skill),
    ''
  ].join('\n');
}

/** Python 脚本占位内容。 */
function renderPython(skill, path) {
  const stem = path.slice(path.lastIndexOf('/') + 1).replace(/\.py$/, '');
  return [
    `"""${skill.display_name} — ${stem} 自动化脚本。`,
    '',
    `由技能包 ${skill.id}@${skill.version} 提供。`,
    `主要能力：${(skill.capabilities || []).join('、')}。`,
    '"""',
    '',
    `SKILL_ID = '${skill.id}'`,
    `SKILL_VERSION = '${skill.version}'`,
    '',
    '',
    'def main() -> None:',
    `    print(f'{SKILL_ID}@{SKILL_VERSION}: ${stem}')`,
    '',
    '',
    "if __name__ == '__main__':",
    '    main()',
    ''
  ].join('\n');
}

/** TypeScript 脚本占位内容。 */
function renderTypeScript(skill, path) {
  const stem = path.slice(path.lastIndexOf('/') + 1).replace(/\.ts$/, '');
  return [
    `/** ${skill.display_name} — ${stem}（${skill.id}@${skill.version}）。 */`,
    `export const skillId = '${skill.id}'`,
    `export const skillVersion = '${skill.version}'`,
    '',
    `export function ${stem.replace(/[^a-zA-Z0-9]/g, '_')}(): string {`,
    `  return \`\${skillId}@\${skillVersion}: ${stem}\``,
    '}',
    ''
  ].join('\n');
}

/** ArcGIS AddIn 配置骨架。 */
function renderEsriAddIn(skill) {
  return [
    '<ESRI.Configuration xmlns="http://schemas.esri.com/Desktop/AddIns"',
    '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    `  <Name>${skill.display_name}</Name>`,
    `  <Description>${skill.summary || ''}</Description>`,
    `  <Version>${skill.version}</Version>`,
    `  <Author>${skill.team || ''}</Author>`,
    '  <Target version="10.8" />',
    '</ESRI.Configuration>',
    ''
  ].join('\n');
}

/** references/ 下的参考文档。 */
function renderReference(skill, path) {
  const title = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
  return [
    `# ${title}`,
    '',
    `本文件为「${skill.display_name}」提供参考资料。上传团队：${skill.team || '-'}。`,
    '',
    '## 关联能力',
    '',
    (skill.capabilities || []).map(item => `- ${item}`).join('\n'),
    '',
    '## 参数说明',
    '',
    paramTable(skill),
    ''
  ].join('\n');
}

/** templates/ 下的输出模板。 */
function renderTemplate(skill, path) {
  const title = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
  return [
    `# ${title}`,
    '',
    `> 「${skill.display_name}」的输出模板。按下列结构填充实际内容。`,
    '',
    '## 一、概述',
    '',
    '（待填充）',
    '',
    '## 二、正文',
    '',
    (skill.capabilities || []).map((item, index) => `${index + 1}. ${item}`).join('\n'),
    '',
    '## 三、结论',
    '',
    '（待填充）',
    ''
  ].join('\n');
}

/** 其余路径的兜底占位。 */
function renderFallback(skill, path) {
  return [
    `# ${path}`,
    '',
    `「${skill.display_name}」（${skill.id}@${skill.version}）技能包中的附加文件。`,
    ''
  ].join('\n');
}

/** 按路径渲染一个文件的 mock 内容。 */
function renderMockFile(skill, path) {
  if (path.endsWith('.py')) return renderPython(skill, path);
  if (path.endsWith('.ts')) return renderTypeScript(skill, path);
  if (path.endsWith('.esriaddinx')) return renderEsriAddIn(skill);
  if (path.startsWith('references/')) return renderReference(skill, path);
  if (path.startsWith('templates/')) return renderTemplate(skill, path);
  return renderFallback(skill, path);
}

/** 代码围栏语言标记（parseAssets 只要求围栏存在，语言仅用于可读性）。 */
function fenceOf(path) {
  if (path.endsWith('.py')) return 'python';
  if (path.endsWith('.ts')) return 'ts';
  if (path.endsWith('.md')) return 'markdown';
  if (path.endsWith('.esriaddinx')) return 'xml';
  return 'text';
}

/**
 * 把 package_files 组装成浏览抽屉可直接解析的 assets 文本
 * （`<!-- file: path -->` + 代码围栏，与 skillDownload.parseAssets 对齐）。
 */
function buildMockAssets(skill) {
  return (skill.package_files || [])
    .map(path => `<!-- file: ${path} -->\n\n\`\`\`${fenceOf(path)}\n${renderMockFile(skill, path)}\n\`\`\``)
    .join('\n\n');
}

/**
 * 归一化一条 mock 技能记录：补默认字段、生成 SKILL.md 正文与 assets。
 * 新增/编辑表单保存时走同一条路径，保证列表与预览读到的结构一致。
 */
export function normalizeMockSkill(entry) {
  const skill = {
    name: entry.id,
    tags: [],
    capabilities: [],
    package_files: [],
    status: 'published',
    downloads: 0,
    version: '1.0.0',
    team: entry.submitter || '',
    updated_at: entry.created_at,
    ...entry
  };
  return {
    ...skill,
    body: entry.body || buildBody(skill),
    assets: entry.assets !== undefined ? entry.assets : buildMockAssets(skill)
  };
}

/** 演示数据的上传时间统一落在 2026-08-25 之后（按条目顺序递增排布）。 */
function seedCreatedAt(index) {
  const pad = (n) => String(n).padStart(2, '0');
  const day = 25 + Math.floor(index / 6);
  const hour = 9 + (index % 6) * 2;
  const minute = (index * 13 + 7) % 60;
  return `2026-08-${pad(day)} ${pad(hour)}:${pad(minute)}:00`;
}

/** 与技能广场对齐的 26 条 mock 技能，后台管理页的初始数据源（上传人统一展示为 root）。 */
export const MARKETPLACE_MOCK_SKILLS = RAW_SKILLS.map((entry, index) =>
  normalizeMockSkill({ ...entry, submitter: 'root', created_at: seedCreatedAt(index) })
);
