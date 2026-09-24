import {
  OfficeExpertWorkbench,
  type ToolDef,
} from './OfficeExpertWorkbench.tsx'
import type { OfficeTaskService } from './office-task.ts'
import { geologyIconImages } from './GeologyIconData.ts'
import { documentHero } from './OfficeExpertHeroImages.ts'
import {
  docExpert,
  docSummary,
  docCompare,
  docInfo,
  docFile,
  docHome,
  docHistory,
} from './office-icons.ts'
const formats = '.docx,.pdf,.xlsx,.xlsm,.txt,.md,.csv,.tsv,.json,.yaml,.yml'
const tools: readonly ToolDef[] = [
  {
    id: 'summary',
    name: '文档摘要与要点提取',
    description:
      '读取一份或多份材料，提炼摘要、重点、风险、时间节点和待办事项。',
    accept: formats,
    multiple: true,
    skill: 'office-document-summary',
    expected: ['\\.docx$', '\\.md$'],
    params: [
      {
        key: 'focus',
        label: '关注内容（用顿号分隔）',
        type: 'text',
        default:
          '综合摘要、核心观点、关键事实、风险与问题、时间节点、待办事项、来源说明',
      },
      {
        key: 'detail',
        label: '摘要详细程度',
        type: 'select',
        options: ['精简', '标准', '详细'],
        default: '标准',
      },
      { key: 'requirements', label: '补充要求', type: 'text', default: '' },
    ],
  },
  {
    id: 'compare',
    name: '文档对比助手',
    description:
      '明确按选择顺序将第一份作为原始版本、第二份作为新版本，比较可提取文本。',
    accept: formats,
    multiple: true,
    skill: 'office-document-compare',
    expected: ['\\.html$', '\\.json$', '\\.(md|diff|txt)$'],
    params: [
      {
        key: 'scope',
        label: '对比范围',
        type: 'text',
        default:
          '新增内容、删除内容、修改内容、数字变化、日期变化、名称或主体变化、重点变化摘要',
      },
      { key: 'requirements', label: '补充要求', type: 'text', default: '' },
    ],
  },
]
export function DocumentIntelligenceWorkbench({
  service,
  expertIcon,
  expertName,
  expertSubtitle,
}: {
  service?: OfficeTaskService | undefined
  expertIcon?: string | undefined
  expertName?: string | undefined
  expertSubtitle?: string | undefined
}) {
  return (
    <OfficeExpertWorkbench
      title={expertName ?? '文档智能处理专家'}
      subtitle={expertSubtitle ?? '摘要提炼与版本差异分析'}
      icon={expertIcon}
      service={service}
      tools={tools}
      visuals={{
        expert: docExpert,
        home: docHome,
        history: docHistory,
        files: docFile,
        guide: docInfo,
        info: docInfo,
        emptyHistory: geologyIconImages.history ?? docHistory,
        emptyFiles: geologyIconImages.files ?? docFile,
        toolIcons: { summary: docSummary, compare: docCompare },
        heroTitle: '读懂文档，提炼真正重要的信息',
        heroText:
          '从多份材料中提炼摘要与行动项，或清晰呈现两个版本之间的文字变化。',
        heroPoints: ['结构化摘要', '关键风险提取', '版本差异分析'],
        heroBackground: documentHero,
      }}
      guide={[
        {
          title: '摘要任务',
          text: '可添加一份或多份 DOCX、PDF、XLSX、XLSM 或常见文本材料，选择摘要详略并填写关注重点。结果提炼核心内容、风险、时间节点和待办事项，同时保留来源边界；扫描 PDF 无文字时需先做 OCR。',
        },
        {
          title: '对比任务',
          text: '按选择顺序添加两份材料：第一份为原始版本，第二份为新版本。工具比较可提取文本的新增、删除、修改及数字、日期、主体等关键变化；文件顺序放反会改变差异方向。',
        },
        {
          title: '能力边界',
          text: '不比较排版、图片、批注、修订痕迹或视觉效果，不支持 PPT 和旧 DOC/XLS。',
        },
        {
          title: '复核要求',
          text: '成果只依据成功读取的材料生成。重要数字、日期、责任主体、风险和结论请回到原文逐项复核；处理不会修改原文件，也不代替专业审查。',
        },
      ]}
    />
  )
}
