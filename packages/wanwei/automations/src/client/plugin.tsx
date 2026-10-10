import { createPanelController, registerFeaturePanel } from '@deepseek-ai/dsh-wanwei-feature-panels/client'
import type { Context } from '@deepseek-ai/cordis'
import './page.css'
import { useState } from 'react'
import { Select } from '@deepseek-ai/dsh-client-ui-primitives'
import { PlusIcon, Toast, type WanweiNotice } from '@deepseek-ai/dsh-wanwei-feature-panels/client'
import { productText } from './locales/product.ts'
/* oxlint-disable @stylistic/max-len, @stylistic/arrow-parens */
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

const AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  { id: 'policy-brief', name: '每日政策与待办简报', summary: productText('在工作日早晨汇总待办、通知与已关注政策动态，生成可编辑简报。'), trigger: '工作日 08:30', cadence: '每个工作日', scope: '当前工作区', steps: ['读取待办', '提炼政策', '生成简报'], accent: '#2563eb', prompt: '汇总当前工作区待办、已接入通知和近期政策要点，按重要程度生成一份每日简报，并标注需跟进事项。' },
  { id: 'tender-change', name: '投标文件变更提醒', summary: productText('关注招标文件与澄清答疑的变动，形成差异摘要并提示责任人。'), trigger: '文件变更时', cadence: '检测到文件变更', scope: '投标工作区', steps: ['检测变更', '解析差异', '发送提醒'], accent: '#dc2626', prompt: '监测当前工作区中的招标文件、答疑和补充通知。如有更新，提取变更条款、影响范围和建议跟进人，输出变更提醒。' },
  { id: 'weekly-progress', name: '项目周报汇总', summary: productText('每周汇总工作区成果、进度和风险事项，生成 Word 周报草稿。'), trigger: '每周五 16:30', cadence: '每周', scope: '当前工作区', steps: ['汇总成果', '提炼进展', '输出周报'], accent: '#059669', prompt: '收集本周工作区内的交付物、对话结论和待办进度，按完成事项、下周计划、风险与需协调事项生成项目周报草稿。' },
  { id: 'meeting-followup', name: '会议纪要待办跟进', summary: productText('会后整理纪要中的任务、负责人和时间节点，形成跟进清单。'), trigger: '每个工作日 17:30', cadence: '每个工作日', scope: '行政复议', steps: ['读取纪要', '抽取待办', '更新清单'], accent: '#7c3aed', prompt: '整理当前工作区新增会议纪要，提取待办事项、负责人和截止时间，生成当日跟进清单；信息不明确时标注待确认。' },
  { id: 'document-archive', name: '成果归档检查', summary: productText('按项目目录检查交付成果是否完整，输出缺失文件和命名建议。'), trigger: '每周四 15:00', cadence: '每周', scope: '项目成果目录', steps: ['扫描目录', '核对清单', '输出提醒'], accent: '#0ea5e9', prompt: '检查当前工作区成果目录中的报告、图件、数据和附件是否齐全，识别缺失项、重复文件与不规范命名，输出归档检查清单。' },
  { id: 'inbox-summary', name: '通知邮件摘要', summary: productText('汇总已授权来源的未读通知，按紧急程度形成简明处理建议。'), trigger: '每个工作日 09:00', cadence: '每个工作日', scope: '已授权连接器', steps: ['读取通知', '判断优先级', '生成摘要'], accent: '#f59e0b', prompt: '汇总已授权消息和邮箱来源中的未读通知，按紧急、重要、一般分类，提取截止时间和建议处理动作，生成晨间摘要。' },
]

const AUTOMATION_HISTORY = [
  { id: 'run-01', name: '项目周报汇总', time: '今天 16:30', status: '已完成', detail: '已生成《项目周报草稿.docx》' },
  { id: 'run-02', name: '投标文件变更提醒', time: '昨天 10:12', status: '已完成', detail: '发现 2 处澄清变更，已生成差异摘要' },
  { id: 'run-03', name: '成果归档检查', time: '08-29 15:00', status: '需关注', detail: '发现 3 项待补充成果' },
] as const

function Automations({ notify }: { notify: (text: string) => void }) {
  const [tab, setTab] = useState<'configured' | 'history' | 'templates'>('configured')
  const [selected, setSelected] = useState<AutomationTemplate | null>(null)
  const [draft, setDraft] = useState<AutomationDraft | null>(null)
  const [configured, setConfigured] = useState<AutomationDraft[]>([])
  const openManual = () =>{  setDraft({ id: `manual-${Date.now()}`, name: '', cadence: '每个工作日', time: '09:00', prompt: '', source: '手动' }) }
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
    notify('自动化任务已保存到本地演示列表，当前不会实际执行。')
  }
  const startConversation = () =>{  notify('已准备自动化创建草稿；正式接入后将新建对话并自动填入任务内容。') }
  return <section className="dsh-automation-page">
    <div className="dsh-automation-actions">
      <button type="button" onClick={openManual}>{productText('手动新建')}</button>
      <button type="button" className="primary" onClick={startConversation}><PlusIcon /> {productText(' 在对话中创建')}</button>
    </div>
    <nav className="dsh-automation-tabs" aria-label={productText('自动化页面')}>
      <button type="button" className={tab === 'configured' ? 'active' : ''} onClick={() =>{  setTab('configured') }}>{productText('已配置')}<span>{configured.length}</span></button>
      <button type="button" className={tab === 'history' ? 'active' : ''} onClick={() =>{  setTab('history') }}>{productText('执行历史')}</button>
      <button type="button" className={tab === 'templates' ? 'active' : ''} onClick={() =>{  setTab('templates') }}>{productText('任务模板')}</button>
    </nav>
    {tab === 'configured' && (configured.length === 0 ? <div className="dsh-automation-empty"><div><AutomationsIcon size={30} /></div><h2>{productText('尚未配置自动化')}</h2><p>{productText('从工作模板开始，建立适合当前工作区的周期任务。')}</p><button type="button" onClick={() =>{  setTab('templates') }}>{productText('从模板创建')}</button></div> : <div className="dsh-automation-configured">{configured.map(item => <article key={item.id}><div className="dsh-automation-configured-icon"><AutomationsIcon size={19} /></div><div><h2>{item.name}</h2><p>{item.cadence} · {item.time} · {item.source}{productText('创建')}</p><small>{item.prompt}</small></div><span>{productText('演示模式')}</span></article>)}</div>)}
    {tab === 'history' && <div className="dsh-automation-history">{AUTOMATION_HISTORY.map(item => <article key={item.id}><div><strong>{item.name}</strong><span>{item.time}</span></div><p>{item.detail}</p><b className={item.status === '需关注' ? 'attention' : ''}>{item.status}</b></article>)}</div>}
    {tab === 'templates' && <div className="dsh-automation-template-grid">{AUTOMATION_TEMPLATES.map(item => <button type="button" className="dsh-automation-template" key={item.id} onClick={() =>{  openTemplate(item) }}><div className="dsh-automation-template-icon" style={{ background: item.accent }}><AutomationsIcon size={20} /></div><strong>{item.name}</strong><span>{item.trigger}</span><p>{item.summary}</p><small>{item.scope}</small></button>)}</div>}
    {draft !== null && <div className="dsh-automation-modal-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) { setDraft(null); setSelected(null) } }}><form className="dsh-automation-modal" onSubmit={event => { event.preventDefault(); saveDraft() }}><header><div><span>{selected === null ? productText('新建自动化任务') : productText('从任务模板创建')}</span><small>{selected === null ? productText('配置一个仅保存在本机演示列表中的任务。') : selected.summary}</small></div><button type="button" onClick={() => { setDraft(null); setSelected(null) }} aria-label={productText('关闭')}>×</button></header><label>{productText('任务名称')}<input autoFocus value={draft.name} onChange={event =>{  setDraft({ ...draft, name: event.target.value }) }} placeholder={productText('例如：项目周报汇总')} /></label><div className="dsh-automation-schedule"><label>{productText('触发频率')}<Select label={productText('触发频率')} value={draft.cadence} onChange={value => { setDraft({ ...draft, cadence: value }) }} options={[{ value: productText('每个工作日'), label: productText('每个工作日') }, { value: productText('每天'), label: productText('每天') }, { value: productText('每周'), label: productText('每周') }, { value: productText('文件变更时'), label: productText('文件变更时') }]} /></label><label>{productText('执行时间')}<input type="time" value={draft.time} onChange={event =>{  setDraft({ ...draft, time: event.target.value }) }} disabled={draft.cadence === '文件变更时'} /></label></div><label>{productText('任务说明')}<textarea value={draft.prompt} onChange={event =>{  setDraft({ ...draft, prompt: event.target.value }) }} placeholder={productText('描述希望智能体按计划完成的工作')} /></label><div className="dsh-automation-modal-tip">{productText('演示阶段仅展示配置流程，不会创建定时任务或调用外部连接器。')}</div><footer><button type="button" onClick={() => { setDraft(null); setSelected(null) }}>{productText('取消')}</button><button type="submit" disabled={draft.name.trim() === '' || draft.prompt.trim() === ''}>{productText('保存任务')}</button></footer></form></div>}
  </section>
}
function AutomationsIcon({ size = 18 }: { size?: number }) {
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


  return <svg {...shared}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.8 2" /><path d="m17.5 4 .7 1.8L20 6.5l-1.8.7-.7 1.8-.7-1.8L15.5 6.5l1.8-.7Z" /></svg>
}

function AutomationPage() {
  const [notice, setNotice] = useState<WanweiNotice | null>(null)
  return <><Automations notify={text => { setNotice({ kind: 'info', text }) }} /><Toast notice={notice} setNotice={setNotice} /></>
}
export const inject = ['slots', 'wanweiNetwork']
/** Mount only the automation demo page; no scheduler is started.
 * @param ctx - Product Client context.
 */
export function apply(ctx: Context): void {
  const controller = createPanelController(ctx, 'wanwei-automations')
  registerFeaturePanel(ctx, 'skill-automations', 10, { controller, title: productText('自动化'),
    subtitle: productText('配置定时执行、事件触发和自动交付流程'), blockedIntranet: false, visibility: ctx.wanweiNetwork.visibility('automations'), Icon: AutomationsIcon,
    hooks: { network: ctx.wanweiNetwork }, renderContent: () => <AutomationPage />,
  })
}
