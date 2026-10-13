/** Reviewed task starters; selecting one creates only an editable draft. */
import type { AutomationTask } from '../contract.ts'
import { productText as text } from './locales/product.ts'

const templates = [
  { id: 'weekly', name: text('项目周报汇总'), description: text('汇总本周进展、待办与风险，生成项目周报。'), prompt: text('汇总工作目录中最近七天的项目资料，整理本周完成事项、进行中工作、待办及风险。生成一份项目周报.docx，重要结论注明资料来源；未明确的信息标注待确认，不要编造，不修改原始资料。'), cadence: 'friday', time: '17:00' },
  { id: 'meeting', name: text('会议纪要待办整理'), description: text('提取会议任务、负责人和时间节点，形成跟进台账。'), prompt: text('读取工作目录中的会议纪要，提取待办事项、负责人、截止时间及相关来源，合并重复事项，输出会议待办台账.xlsx；缺少的负责人和时间标注待确认，不修改原始纪要，不自动发送通知。'), cadence: 'workdays', time: '17:30' },
  { id: 'compare', name: text('文档更新检查'), description: text('检查资料的新旧版本，整理新增、删除和修改内容。'), prompt: text('检查工作目录内可识别的新旧文档版本，比较正文新增、删除和修改内容，输出文档更新检查.docx并注明比较文件；版本关系不明确时说明限制，不修改原始文件。'), cadence: 'workdays', time: '09:00' },
  { id: 'excel', name: text('Excel 台账检查'), description: text('检查空值、重复记录和格式问题，生成质量清单。'), prompt: text('检查工作目录中的 Excel 台账，记录空值、重复记录、日期及数字格式问题，生成台账质量检查.xlsx并注明来源文件、工作表和行号；仅检查，不修改、删除或覆盖原始台账。'), cadence: 'workdays', time: '09:30' },
  { id: 'archive', name: text('成果归档检查'), description: text('核对交付资料与文件命名，列出缺失和待确认项。'), prompt: text('只读检查工作目录中的成果文件，按文件类型和项目整理清单，核对已有交付要求，标注缺失资料、重复命名及待确认项，输出成果归档检查.xlsx；没有交付要求时只列清单，不推定资料缺失，不移动或删除原文件。'), cadence: 'friday', time: '16:30' },
  { id: 'risk', name: text('项目风险汇总'), description: text('整理风险、责任人和期限，输出风险跟踪报告。'), prompt: text('阅读工作目录中的项目记录，汇总明确记载的风险、责任人、处理进展和期限，输出项目风险跟踪.docx，逐项注明资料来源；缺失的信息标注待确认，不作无来源推断，不修改原始记录。'), cadence: 'workdays', time: '16:00' },
] as const
const paths = {
  weekly: 'M5 3h10l4 4v14H5z M14 3v5h5 M8 12h8 M8 16h6',
  meeting: 'M8 4h8v4H8z M6 6H4v15h16V6h-2 M7 12l2 2 3-3 M13 16h4',
  compare: 'M3 5h7v14H3z M14 5h7v14h-7z M7 9h0 M17 9h0 M10 12h4 M12 10l2 2-2 2',
  excel: 'M4 4h16v16H4z M4 9h16 M4 14h16 M10 4v16',
  archive: 'M3 5h18v4H3z M5 9v12h14V9 M9 13h6',
  risk: 'M12 3 2 21h20z M12 9v5 M12 17v1',
} as const

/** Render office-oriented templates using the product's existing card tokens.
 * @param props - Back navigation and draft-only selection.
 * @returns Template card page; no saved task or run record is fabricated.
 */
export function CreationPicker({ onBack, onSelect }: {
  onBack: () => void
  onSelect: (value: Pick<AutomationTask, 'name' | 'prompt' | 'cadence' | 'time'>) => void
}) {
  return <section className="dsh-automation-page automation-creation-page">
    <header className="automation-creation-header">
      <button type="button" aria-label={text('返回定时任务')} onClick={onBack}>‹</button>
      <h2>{text('从模板添加')}</h2>
    </header>
    <p className="automation-creation-caption">{text('选择模板后，请确认任务说明、工作目录和执行时间。')}</p>
    <div className="automation-template-grid">{templates.map(template => <button type="button" key={template.id}
      className="automation-template-card" onClick={() => {
        onSelect({ name: template.name, prompt: template.prompt, cadence: template.cadence, time: template.time })
      }}>
      <div className="automation-template-main">
        <span className={`automation-template-icon tone-${template.id}`}><svg width="24" height="24" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={paths[template.id]} /></svg></span>
        <div className="automation-template-body">
          <h3>{template.name}</h3>
          <p>{template.description}</p>
        </div>
      </div>
      <div className="automation-template-meta">
        <small>◷ {template.cadence === 'friday' ? text('每周五') : text('每个工作日')} {template.time}</small>
        <span className="automation-template-format">{text(['meeting', 'excel', 'archive'].includes(template.id) ? 'XLSX' : 'DOCX')}</span>
      </div>
    </button>)}</div>
  </section>
}
