/** Desktop task cards backed exclusively by authenticated Host data. */
import { useEffect, useId, useRef, useState } from 'react'
import { Select } from '@deepseek-ai/dsh-client-ui-primitives'
import { productText as text } from './locales/product.ts'
import type { AutomationSnapshot, AutomationTask } from '../contract.ts'
import { CreationPicker } from './creation.tsx'

/** Local RPC and normal desktop Session navigation. */
export interface AutomationApi {
  call(operation: string, payload: unknown, signal?: AbortSignal): Promise<AutomationSnapshot>
  openSession(id: string): void
  fromTask(): void
}
const cadenceLabel = (value: AutomationTask['cadence']) => value === 'daily' ? text('每天') : value === 'workdays' ? text('每个工作日') : text('每周五')

/** Show only committed tasks and execution records.
 * @param props - Host operations and desktop notification callback.
 * @returns Card list, editor and actual execution history.
 */
export function AutomationCards({ notify, api }: { notify: (message: string) => void; api: AutomationApi }) {
  const prefix = useId()
  const revision = useRef(0)
  const pending = useRef(false)
  const lifetime = useRef<AbortController | null>(null)
  const [snapshot, setSnapshot] = useState<AutomationSnapshot>({ tasks: [], runs: [] })
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'tasks' | 'history'>('tasks')
  const [filter, setFilter] = useState<'all' | 'enabled' | 'paused'>('all')
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [batch, setBatch] = useState(false)
  const [selection, setSelection] = useState<string[]>([])
  const [draft, setDraft] = useState<AutomationTask | null>(null)
  const [deleteIds, setDeleteIds] = useState<string[]>([])
  const [creation, setCreation] = useState(false)
  const newMenu = useRef<HTMLDetailsElement>(null)
  const tasks = snapshot.tasks
  const visible = tasks.filter(task => task.name.includes(query) && (filter === 'all' || task.enabled === (filter === 'enabled')))
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    let refreshing = false
    const refresh = async () => {
      if (refreshing || pending.current) return
      refreshing = true
      const started = revision.current
      try {
        const value = await api.call('list', {}, controller.signal)
        if (!controller.signal.aborted && started === revision.current) { setSnapshot(value); setLoaded(true); setError('') }
      } catch (failure) {
        if (!controller.signal.aborted && started === revision.current) {
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      } finally { refreshing = false }
    }
    void refresh()
    const interval = setInterval(() => { void refresh() }, 3000)
    return () => { controller.abort(); clearInterval(interval) }
  }, [api])
  const mutate = async (operation: string, payload: unknown, message: string): Promise<boolean> => {
    if (pending.current) return false
    pending.current = true
    revision.current++
    const signal = lifetime.current?.signal
    setBusy(true)
    try {
      const value = await api.call(operation, payload, signal)
      if (signal?.aborted) return false
      setSnapshot(value); setLoaded(true); setError(''); notify(message)
      return true
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof Error ? failure.message : String(failure)); return false
    } finally { pending.current = false; if (!signal?.aborted) setBusy(false) }
  }
  const create = () => { setDraft({ id: '', nextRunAt: 0, name: '', prompt: '', cwd: '', cadence: 'workdays', time: '09:00', enabled: true }) }
  const chooseCreation = (mode: 'manual' | 'templates' | 'conversation') => {
    newMenu.current?.removeAttribute('open')
    if (mode === 'manual') create()
    else if (mode === 'conversation') api.fromTask()
    else { setCreation(true); setBatch(false); setSelection([]) }
  }
  const enable = (ids: string[], enabled: boolean) => {
    void mutate('enable', { ids, enabled }, text('任务状态已保存')).then((ok) => { if (ok) setSelection([]) })
  }
  const save = async () => {
    if (draft === null) return
    const { id, nextRunAt: _next, ...task } = draft
    if (await mutate('save', { ...(id ? { id } : {}), task }, text('任务已保存'))) {
      setDraft(null); setTab('tasks'); setFilter('all'); setQuery('')
    }
  }
  if (creation) return <CreationPicker onBack={() => { setCreation(false) }} onSelect={(value) => {
    setCreation(false)
    setDraft({ id: '', nextRunAt: 0, cwd: '', enabled: false, ...value })
  }} />
  return <section className={`dsh-automation-page dsh-automation-cards${batch && tab === 'tasks' ? ' batch-mode' : ''}`}>
    <header className="automation-card-toolbar">
      <nav aria-label={text('自动化页面')}>
        <button type="button" className={tab === 'tasks' ? 'selected' : ''} onClick={() => { setTab('tasks') }}>{text('定时任务')}</button>
        <button type="button" className={tab === 'history' ? 'selected' : ''} onClick={() => { setTab('history') }}>{text('运行记录')}</button>
      </nav>
      <div className="automation-card-tools">
        <button type="button" className="icon-button" aria-label={text('搜索任务')} onClick={() => { setTab('tasks'); setSearchOpen(value => !value) }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="m16 16 5 5" /></svg>
        </button>
        <button type="button" onClick={() => { setTab('tasks'); setBatch(value => !value); setSelection([]) }}>{batch ? text('完成管理') : text('批量管理')}</button>
        <div className="automation-new-group">
          <button type="button" className="primary" disabled={busy} onClick={create}>{text('＋ 新建')}</button>
          <details ref={newMenu} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.removeAttribute('open') }} onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.removeAttribute('open') }}>
            <summary aria-label={text('新建方式')}>⌄</summary>
            <div className="automation-dropdown">
              <button type="button" disabled={busy} onClick={() => { chooseCreation('manual') }}>＋ {text('手动新建')}</button>
              <button type="button" disabled={busy} onClick={() => { chooseCreation('conversation') }}>↗ {text('从任务新建')}</button>
              <button type="button" disabled={busy} onClick={() => { chooseCreation('templates') }}>▦ {text('从模板新建')}</button>
            </div>
          </details>
        </div>
      </div>
    </header>
    <p className="automation-demo-label">{text('任务保存在本机，使用默认模型；执行时会新建会话并可能修改指定工作目录。')}</p>
    {error && <p role="alert" className="automation-error">{error}</p>}
    {!loaded && !error && <p>{text('正在加载任务')}</p>}
    <fieldset disabled={busy} className="automation-content">
      {tab === 'tasks' && <>
        {searchOpen && <input className="automation-search" aria-label={text('搜索任务')} placeholder={text('搜索任务名称')} value={query} onChange={(event) => { setQuery(event.target.value) }} />}
        <div className="automation-card-filters">{(['all', 'enabled', 'paused'] as const).map(value => <button type="button" key={value} className={filter === value ? 'selected' : ''} onClick={() => { setFilter(value) }}>
          {value === 'all' ? text('全部') : value === 'enabled' ? text('已启用') : text('已暂停')}{' ('}{tasks.filter(task => value === 'all' || task.enabled === (value === 'enabled')).length}{')'}
        </button>)}</div>
        <div className="automation-task-grid">{visible.map(task => <article key={task.id} className={`automation-task-card${task.enabled ? '' : ' paused'}`}>
          <div className="automation-task-heading">
            {batch && <input type="checkbox" aria-label={text('选择任务 {0}', [task.name])} checked={selection.includes(task.id)} onChange={(event) => { setSelection(ids => event.target.checked ? [...ids, task.id] : ids.filter(id => id !== task.id)) }} />}
            <button type="button" className="automation-task-name" title={task.name} onClick={() => { setDraft({ ...task }) }}>{task.name}</button>
            <button type="button" className={`automation-task-switch${task.enabled ? ' on' : ''}`} role="switch" aria-checked={task.enabled} aria-label={text('启用任务 {0}', [task.name])} onClick={() => { enable([task.id], !task.enabled) }} />
            <details className="automation-task-more"><summary aria-label={text('任务 {0} 更多操作', [task.name])}>⋯</summary><div className="automation-dropdown">
              <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setDraft({ ...task }) }}>{text('编辑任务')}</button>
              <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); void mutate('run', { id: task.id }, text('已开始执行，请查看运行记录')) }}>{text('立即执行')}</button>
              <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setDeleteIds([task.id]) }}>{text('删除任务')}</button>
            </div></details>
          </div>
          <p title={task.prompt}>{task.prompt}</p>
          <footer><span>◷ {cadenceLabel(task.cadence)} {task.time}</span><span>{task.enabled ? text('下次：{0}', [new Date(task.nextRunAt).toLocaleString()]) : text('已暂停，不再定时执行')}</span></footer>
        </article>)}</div>
        {loaded && !visible.length && <div className="dsh-automation-empty"><h2>{tasks.length ? text('没有符合条件的任务') : text('尚未配置自动化')}</h2><button type="button" onClick={create}>{text('手动新建')}</button></div>}
      </>}
      {tab === 'history' && (snapshot.runs.length === 0 ? <div className="dsh-automation-empty"><h2>{text('暂无真实运行记录')}</h2></div>
        : <div className="automation-run-list">{snapshot.runs.map(run => <article key={run.id}>
          <header><strong>{run.taskName}</strong><span>{run.status === 'running' ? text('执行中') : run.status === 'success' ? text('已完成') : run.status === 'interrupted' ? text('已中断') : text('执行失败')}</span></header>
          <p>{new Date(run.startedAt).toLocaleString()} · {run.trigger === 'manual' ? text('手动执行') : text('定时执行')}</p>
          {run.error && <p className="automation-error">{run.error}</p>}
          {run.sessionId && <button type="button" onClick={() => { if (run.sessionId) api.openSession(run.sessionId) }}>{text('查看会话与产物')}</button>}
          {run.status === 'running' && <button type="button" onClick={() => { void mutate('stop', { id: run.id }, text('已请求停止')) }}>{text('停止执行')}</button>}
        </article>)}</div>)}
      {batch && tab === 'tasks' && <footer className="automation-batch-bar" role="toolbar" aria-label={text('批量管理')}>
        <div className="automation-batch-selection">
          <label><input type="checkbox" checked={visible.length > 0 && visible.every(task => selection.includes(task.id))} onChange={(event) => { setSelection(event.target.checked ? visible.map(task => task.id) : []) }} />{text('全选当前任务')}</label>
          <span>{text('已选择 {0} 项', [selection.length])}</span>
        </div>
        <div className="automation-batch-actions">
          <button type="button" disabled={!selection.length} onClick={() => { enable(selection, true) }}>{text('启用')}</button>
          <button type="button" disabled={!selection.length} onClick={() => { enable(selection, false) }}>{text('暂停')}</button>
          <button type="button" disabled={!selection.length} onClick={() => { setDeleteIds(selection) }}>{text('删除')}</button>
        </div>
      </footer>}
      {draft !== null && <div className="dsh-automation-modal-backdrop"><form className="dsh-automation-modal automation-card-dialog" role="dialog" aria-modal="true" aria-labelledby={`${prefix}-title`} onSubmit={(event) => { event.preventDefault(); void save() }}>
        <header><div><span id={`${prefix}-title`}>{draft.id ? text('编辑任务') : text('新建自动化任务')}</span><small>{text('任务和运行记录保存在本机。')}</small></div><button type="button" aria-label={text('关闭')} onClick={() => { setDraft(null) }}>×</button></header>
        <label>{text('任务名称')}<input autoFocus required maxLength={80} value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }) }} placeholder={text('例如：项目周报汇总')} /></label>
        <label>{text('任务说明')}<textarea required maxLength={20000} value={draft.prompt} onChange={(event) => { setDraft({ ...draft, prompt: event.target.value }) }} placeholder={text('描述希望智能体按计划完成的工作')} /></label>
        <label>{text('工作目录')}<input required value={draft.cwd} placeholder={text('填写本机工作目录的绝对路径')} onChange={(event) => { setDraft({ ...draft, cwd: event.target.value }) }} /></label>
        <div className="dsh-automation-schedule"><label>{text('触发频率')}<Select label={text('触发频率')} value={draft.cadence} onChange={(value) => { setDraft({ ...draft, cadence: value as AutomationTask['cadence'] }) }} options={(['daily', 'workdays', 'friday'] as const).map(value => ({ value, label: cadenceLabel(value) }))} /></label>
          <label>{text('执行时间')}<input type="time" required value={draft.time} onChange={(event) => { setDraft({ ...draft, time: event.target.value }) }} /></label></div>
        <label className="automation-draft-switch"><input type="checkbox" checked={draft.enabled} onChange={(event) => { setDraft({ ...draft, enabled: event.target.checked }) }} />{text('保存后启用')}</label>
        <div className="dsh-automation-modal-tip">{text('保存并启用表示允许任务按计划调用默认模型及工作区内工具。需要人工确认的操作仍须在会话中处理。')}</div>
        {error && <p role="alert" className="automation-error">{error}</p>}
        <footer><button type="button" onClick={() => { setDraft(null) }}>{text('取消')}</button><button type="submit" disabled={!draft.name.trim() || !draft.prompt.trim() || !draft.cwd.trim()}>{text('保存任务')}</button></footer>
      </form></div>}
      {deleteIds.length > 0 && <div className="dsh-automation-modal-backdrop"><section className="dsh-automation-modal" role="dialog" aria-modal="true" aria-label={text('删除任务')}>
        <header><span>{text('删除任务')}</span></header><p>{text('删除所选任务？此操作不会删除工作目录、会话或产物。')}</p>
        <footer><button type="button" onClick={() => { setDeleteIds([]) }}>{text('取消')}</button><button type="button" onClick={() => {
          void mutate('delete', { ids: deleteIds }, text('任务已删除')).then((ok) => { if (ok) { setDeleteIds([]); setSelection([]) } })
        }}>{text('确认删除')}</button></footer>
      </section></div>}
    </fieldset>
  </section>
}
