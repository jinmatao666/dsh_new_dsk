/** Desktop task cards backed exclusively by authenticated Host data. */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { productText as text } from './locales/product.ts'
import type { AutomationSnapshot, AutomationTask } from '../contract.ts'
import { CreationPicker } from './creation.tsx'
import { TaskEditor } from './task-editor.tsx'
import { RunHistory } from './run-history.tsx'
import { CreationIcon } from './creation-icons.tsx'
import { AutomationSearch } from './search.tsx'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import { cadenceLabel } from './task-labels.ts'

/** Local RPC and normal desktop Session navigation. */
export interface AutomationApi {
  call(operation: string, payload: unknown, signal?: AbortSignal): Promise<AutomationSnapshot>
  openSession(id: string): void
  fromTask(): void
  listWorkspaces(): Promise<{ title: string; path: string }[]>
  createAutomaticWorkspace?(): Promise<string>
  chooseDirectory(): Promise<string | null>
  listModels(): Promise<ModelCatalog>
  connectionDialog?(channel: string, complete: (connected: boolean) => void): ReactNode
  listConnectors?(): Promise<{ id: 'feishu' | 'dingtalk' | 'wechat'; name: string; icon: string; connected: boolean }[]>
}

/** Show only committed tasks and execution records.
 * @param props - Host operations and desktop notification callback.
 * @returns Card list, editor and actual execution history.
 */
export function AutomationCards({ notify, api }: { notify: (message: string) => void; api: AutomationApi }) {
  const prefix = useId()
  const revision = useRef(0)
  const pending = useRef(false)
  const saving = useRef(false)
  const lifetime = useRef<AbortController | null>(null)
  const [snapshot, setSnapshot] = useState<AutomationSnapshot>({ tasks: [], runs: [] })
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'tasks' | 'history'>('tasks')
  const [filter, setFilter] = useState<'all' | 'enabled' | 'paused'>('all')
  const [query, setQuery] = useState('')
  const [batch, setBatch] = useState(false)
  const [selection, setSelection] = useState<string[]>([])
  const [draft, setDraft] = useState<AutomationTask | null>(null)
  const [deleteIds, setDeleteIds] = useState<string[]>([])
  const [deleteRunId, setDeleteRunId] = useState<string | null>(null)
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
    if (draft === null || saving.current) return
    saving.current = true; setBusy(true); setError('')
    try {
      let prepared = draft
      if (!prepared.cwd.trim()) {
        if (!api.createAutomaticWorkspace) throw new Error(text('无法创建默认工作区，请稍后重试。'))
        const cwd = await api.createAutomaticWorkspace()
        prepared = { ...prepared, cwd }
        setDraft(prepared)
      }
      const { id, nextRunAt: _next, ...task } = prepared
      if (await mutate('save', { ...(id ? { id } : {}), task }, text('任务已保存'))) {
        setDraft(null); setTab('tasks'); setFilter('all'); setQuery('')
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { saving.current = false; setBusy(false) }
  }

  if (creation) return <CreationPicker onBack={() => { setCreation(false) }} onSelect={(value) => {
    setCreation(false)
    setDraft({ id: '', nextRunAt: 0, cwd: '', enabled: true, ...value })
  }} />
  const tabs = <nav aria-label={text('自动化页面')}>
    <button type="button" className={tab === 'tasks' ? 'selected' : ''} onClick={() => { setTab('tasks') }}>{text('定时任务')}</button>
    <button type="button" className={tab === 'history' ? 'selected' : ''} onClick={() => { setTab('history') }}>{text('运行记录')}</button>
  </nav>
  return <section className={`dsh-automation-page dsh-automation-cards${batch && tab === 'tasks' ? ' batch-mode' : ''}`}>
    {tab === 'tasks' && <header className="automation-card-toolbar">
      {tabs}
      <div className="automation-card-tools">
        <AutomationSearch label={text('搜索任务')} query={query} change={setQuery} />
        <button type="button" onClick={() => { setBatch(value => !value); setSelection([]) }}>{batch ? text('完成管理') : text('批量管理')}</button>
        <div className="automation-new-group">
          <button type="button" className="primary" disabled={busy} onClick={create}>
            <CreationIcon name="plus" /><span>{text('新建')}</span>
          </button>
          <details ref={newMenu} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.removeAttribute('open') }} onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.removeAttribute('open') }}>
            <summary aria-label={text('新建方式')}><CreationIcon name="chevron-down" /></summary>
            <div className="automation-dropdown">
              <button type="button" disabled={busy} onClick={() => { chooseCreation('manual') }}>
                <CreationIcon name="file-plus" /><span>{text('手动新建')}</span>
              </button>
              <button type="button" disabled={busy} onClick={() => { chooseCreation('conversation') }}>
                <CreationIcon name="message-square-plus" /><span>{text('从任务新建')}</span>
              </button>
              <button type="button" disabled={busy} onClick={() => { chooseCreation('templates') }}>
                <CreationIcon name="layout-template" /><span>{text('从模板新建')}</span>
              </button>
            </div>
          </details>
        </div>
      </div>
    </header>}
    {error && draft === null && <p role="alert" className="automation-error">{error}</p>}
    {!loaded && !error && <p>{text('正在加载任务')}</p>}
    <fieldset disabled={busy} className="automation-content">
      {tab === 'tasks' && <>
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
      {tab === 'history' && <RunHistory heading={tabs} runs={snapshot.runs} retryDelivery={(id) => { void mutate('retry-delivery', { id }, text('已重试推送')) }} openSession={(id) => { api.openSession(id) }} remove={setDeleteRunId} />}
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
      {draft !== null && <TaskEditor saving={busy} draft={draft} change={setDraft} api={api} error={error} titleId={`${prefix}-title`} close={() => { setDraft(null) }} save={() => { void save() }} />}
      {deleteRunId !== null && <div className="dsh-automation-modal-backdrop"><section className="dsh-automation-modal" role="dialog" aria-modal="true" aria-label={text('删除运行记录')}>
        <header><span>{text('删除运行记录')}</span></header><p>{text('仅删除这条运行记录，不会删除任务、会话或产物。')}</p>
        <footer><button type="button" onClick={() => { setDeleteRunId(null) }}>{text('取消')}</button><button type="button" onClick={() => {
          void mutate('delete-run', { id: deleteRunId }, text('运行记录已删除')).then((ok) => { if (ok) setDeleteRunId(null) })
        }}>{text('确认删除')}</button></footer>
      </section></div>}
      {deleteIds.length > 0 && <div className="dsh-automation-modal-backdrop"><section className="dsh-automation-modal" role="dialog" aria-modal="true" aria-label={text('删除任务')}>
        <header><span>{text('删除任务')}</span></header><p>{text('删除所选任务？此操作不会删除工作目录、会话或产物。')}</p>
        <footer><button type="button" onClick={() => { setDeleteIds([]) }}>{text('取消')}</button><button type="button" onClick={() => {
          void mutate('delete', { ids: deleteIds }, text('任务已删除')).then((ok) => { if (ok) { setDeleteIds([]); setSelection([]) } })
        }}>{text('确认删除')}</button></footer>
      </section></div>}
    </fieldset>
  </section>
}
