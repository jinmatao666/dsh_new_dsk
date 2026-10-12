/** Desktop-owned task-card preview; mutations stay in the mounted React instance. */
import { useId, useState } from 'react'
import { Select } from '@deepseek-ai/dsh-client-ui-primitives'
import { productText as text } from './locales/product.ts'

type Task = { id: string; name: string; prompt: string; cadence: string; time: string; enabled: boolean }
const samples: readonly Task[] = [
  { id: 'weekly', name: text('项目周报汇总'), prompt: text('每周汇总工作区成果、进度和风险事项，生成 Word 周报草稿。'), cadence: text('每周五'), time: '17:00', enabled: true },
  { id: 'meeting', name: text('会议纪要待办整理'), prompt: text('会后整理纪要中的任务、负责人和时间节点，形成跟进清单。'), cadence: text('每个工作日'), time: '17:30', enabled: true },
  { id: 'archive', name: text('成果归档检查'), prompt: text('按项目目录检查交付成果是否完整，输出缺失文件和命名建议。'), cadence: text('每天'), time: '09:00', enabled: false },
]

/** Render mock tasks inside the desktop; no Host writes or execution occur.
 * @param props - Page notification callback.
 * @returns Task cards, filters and editing dialog.
 */
export function AutomationCards({ notify }: { notify: (message: string) => void }) {
  const prefix = useId()
  const [tasks, setTasks] = useState<Task[]>(() => samples.map(task => ({ ...task })))
  const [tab, setTab] = useState<'tasks' | 'history' | 'templates'>('tasks')
  const [filter, setFilter] = useState<'all' | 'enabled' | 'paused'>('all')
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [batch, setBatch] = useState(false)
  const [selection, setSelection] = useState<readonly string[]>([])
  const [draft, setDraft] = useState<Task | null>(null)
  const [deleteIds, setDeleteIds] = useState<readonly string[]>([])
  const [sequence, setSequence] = useState(0)
  const visible = tasks.filter(task => task.name.includes(query)
    && (filter === 'all' || task.enabled === (filter === 'enabled')))
  const allSelected = visible.length > 0 && visible.every(task => selection.includes(task.id))
  const closeDraft = () => { setDraft(null) }
  const create = (template?: Task) => {
    setSequence(value => value + 1)
    setDraft({ name: '', prompt: '', cadence: text('每个工作日'), time: '09:00', enabled: true,
      ...template, id: `${prefix}-${sequence}` })
  }
  const updateEnabled = (ids: readonly string[], enabled: boolean) => {
    setTasks(items => items.map(task => ids.includes(task.id) ? { ...task, enabled } : task))
    setSelection([])
    notify(text('已更新演示任务，不会实际执行。'))
  }
  const save = () => {
    if (draft === null || !draft.name.trim() || !draft.prompt.trim() || !draft.time) return
    const value = { ...draft, name: draft.name.trim(), prompt: draft.prompt.trim() }
    setTasks(items => items.some(task => task.id === value.id)
      ? items.map(task => task.id === value.id ? value : task) : [value, ...items])
    setDraft(null); setTab('tasks'); setFilter('all'); setQuery('')
    notify(text('自动化任务已保存到演示列表，当前不会实际执行。'))
  }
  return <section className="dsh-automation-page dsh-automation-cards">
    <header className="automation-card-toolbar">
      <nav aria-label={text('自动化页面')}>
        <button type="button" className={tab === 'tasks' ? 'selected' : ''} onClick={() => { setTab('tasks') }}>{text('定时任务')}</button>
        <button type="button" className={tab === 'history' ? 'selected' : ''} onClick={() => { setTab('history') }}>{text('运行记录')}</button>
        {tab === 'templates' && <span className="selected">{text('任务模板')}</span>}
      </nav>
      <div className="automation-card-tools">
        <button type="button" className="icon-button" aria-label={text('筛选任务')}
          onClick={() => { setTab('tasks'); setFilter(value => value === 'all' ? 'enabled' : value === 'enabled' ? 'paused' : 'all') }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 5h16l-6 7v6l-4 2v-8z" /></svg>
        </button>
        <button type="button" className="icon-button" aria-label={text('搜索任务')} onClick={() => { setTab('tasks'); setSearchOpen(value => !value) }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="m16 16 5 5" /></svg>
        </button>
        <button type="button" onClick={() => { setTab('tasks'); setBatch(value => !value); setSelection([]) }}>{batch ? text('完成管理') : text('批量管理')}</button>
        <div className="automation-new-group">
          <button type="button" className="primary" onClick={() => { create() }}>{text('＋ 新建')}</button>
          <details><summary aria-label={text('新建方式')}>⌄</summary><div className="automation-dropdown">
            <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); create() }}>{text('手动新建')}</button>
            <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setTab('templates') }}>{text('从模板创建')}</button>
          </div></details>
        </div>
      </div>
    </header>
    <p className="automation-demo-label">{text('演示预览：任务与操作仅保留在当前页面，不会实际调度或调用模型。')}</p>
    {tab === 'tasks' && <>
      {searchOpen && <input className="automation-search" aria-label={text('搜索任务')} placeholder={text('搜索任务名称')}
        value={query} onChange={(event) => { setQuery(event.target.value) }} />}
      <div className="automation-card-filters">
        {(['all', 'enabled', 'paused'] as const).map(value => <button type="button" key={value}
          className={filter === value ? 'selected' : ''} onClick={() => { setFilter(value) }}>
          {value === 'all' ? text('全部') : value === 'enabled' ? text('已启用') : text('已暂停')}
          {' ('}{tasks.filter(task => value === 'all' || task.enabled === (value === 'enabled')).length}{')'}
        </button>)}
      </div>
      {batch && <div className="automation-batch-bar"><label><input type="checkbox" checked={allSelected}
        onChange={(event) => { setSelection(event.target.checked ? visible.map(task => task.id) : []) }} />{text('全选当前任务')}</label>
      <span>{text('已选择 {0} 项', [selection.length])}</span>
      <button type="button" disabled={!selection.length} onClick={() => { updateEnabled(selection, true) }}>{text('启用')}</button>
      <button type="button" disabled={!selection.length} onClick={() => { updateEnabled(selection, false) }}>{text('暂停')}</button>
      <button type="button" disabled={!selection.length} onClick={() => { setDeleteIds(selection) }}>{text('删除')}</button>
      </div>}
      <div className="automation-task-grid">{visible.map(task => <article key={task.id} className={`automation-task-card${task.enabled ? '' : ' paused'}`}>
        <div className="automation-task-heading">
          {batch && <input type="checkbox" aria-label={text('选择任务 {0}', [task.name])} checked={selection.includes(task.id)}
            onChange={(event) => { setSelection(ids => event.target.checked ? [...ids, task.id] : ids.filter(id => id !== task.id)) }} />}
          <button type="button" className="automation-task-name" title={task.name} onClick={() => { setDraft({ ...task }) }}>{task.name}</button>
          <button type="button" className={`automation-task-switch${task.enabled ? ' on' : ''}`} role="switch"
            aria-checked={task.enabled} aria-label={text('启用任务 {0}', [task.name])} onClick={() => { updateEnabled([task.id], !task.enabled) }} />
          <details className="automation-task-more"><summary aria-label={text('任务 {0} 更多操作', [task.name])}>⋯</summary><div className="automation-dropdown">
            <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setDraft({ ...task }) }}>{text('编辑任务')}</button>
            <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); notify(text('演示模式不会启动真实执行。')) }}>{text('测试运行')}</button>
            <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setDeleteIds([task.id]) }}>{text('删除任务')}</button>
          </div></details>
        </div>
        <p title={task.prompt}>{task.prompt}</p>
        <footer><span>◷ {task.cadence} {task.time}</span><span>{task.enabled ? text('待正式调度接入') : text('已暂停，不再定时执行')}</span></footer>
      </article>)}</div>
      {!visible.length && <div className="dsh-automation-empty"><h2>{text('没有符合条件的任务')}</h2><button type="button" onClick={() => { create() }}>{text('手动新建')}</button></div>}
    </>}
    {tab === 'history' && <div className="dsh-automation-empty"><h2>{text('暂无真实运行记录')}</h2><p>{text('接入调度后，每次执行会记录状态、对话和最终产物。')}</p></div>}
    {tab === 'templates' && <div className="dsh-automation-template-grid">{samples.map(task =>
      <button type="button" key={task.id} className="dsh-automation-template" onClick={() => { create(task) }}>
        <strong>{task.name}</strong><span>{task.cadence} {task.time}</span><p>{task.prompt}</p><small>{text('本地文件模板')}</small>
      </button>)}</div>}
    <p className="automation-card-footnote">{text('正式任务需要电脑和 DSH 保持运行；错过的任务不会自动补执行。')}</p>
    {draft !== null && <div className="dsh-automation-modal-backdrop">
      <form className="dsh-automation-modal automation-card-dialog" role="dialog" aria-modal="true" aria-labelledby={`${prefix}-title`}
        onSubmit={(event) => { event.preventDefault(); save() }}>
        <header><div><span id={`${prefix}-title`}>{tasks.some(task => task.id === draft.id) ? text('编辑任务') : text('新建自动化任务')}</span>
          <small>{text('配置一个仅保存在本机演示列表中的任务。')}</small></div><button type="button" aria-label={text('关闭')} onClick={closeDraft}>×</button></header>
        <label>{text('任务名称')}<input autoFocus required maxLength={80} value={draft.name}
          onChange={(event) => { setDraft({ ...draft, name: event.target.value }) }} placeholder={text('例如：项目周报汇总')} /></label>
        <label>{text('任务说明')}<textarea required value={draft.prompt} onChange={(event) => { setDraft({ ...draft, prompt: event.target.value }) }}
          placeholder={text('描述希望智能体按计划完成的工作')} /></label>
        <div className="dsh-automation-schedule"><label>{text('触发频率')}<Select label={text('触发频率')} value={draft.cadence}
          onChange={(value) => { setDraft({ ...draft, cadence: value }) }} options={(['每天', '每个工作日', '每周五'] as const).map(value => ({ value: text(value), label: text(value) }))} /></label>
        <label>{text('执行时间')}<input type="time" required value={draft.time} onChange={(event) => { setDraft({ ...draft, time: event.target.value }) }} /></label></div>
        <label className="automation-draft-switch"><input type="checkbox" checked={draft.enabled}
          onChange={(event) => { setDraft({ ...draft, enabled: event.target.checked }) }} />{text('保存后启用')}</label>
        <div className="dsh-automation-modal-tip">{text('演示阶段仅展示配置流程，不会创建定时任务或调用外部连接器。')}</div>
        <footer><button type="button" onClick={closeDraft}>{text('取消')}</button><button type="submit" disabled={!draft.name.trim() || !draft.prompt.trim()}>{text('保存任务')}</button></footer>
      </form></div>}
    {deleteIds.length > 0 && <div className="dsh-automation-modal-backdrop"><section className="dsh-automation-modal" role="dialog" aria-modal="true" aria-label={text('删除任务')}>
      <header><span>{text('删除任务')}</span></header><p>{text('删除所选演示任务？此操作不会删除工作目录或文件。')}</p>
      <footer><button type="button" onClick={() => { setDeleteIds([]) }}>{text('取消')}</button><button type="button"
        onClick={() => { setTasks(items => items.filter(task => !deleteIds.includes(task.id))); setSelection([]); setDeleteIds([]) }}>{text('确认删除')}</button></footer>
    </section></div>}
  </section>
}
