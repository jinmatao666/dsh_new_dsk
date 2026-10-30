/** Task editor with real model, permission and calendar choices. */
import { useEffect, useRef, useState } from 'react'
import { IconChevronDownOutline14, IconCloseOutline16, IconFolderClose16, IconSearchOutline16, IconCheckOutline16, IconWarningOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import type { AutomationTask } from '../contract.ts'
import type { AutomationApi } from './task-cards.tsx'
import { TaskPopover } from './task-popover.tsx'
import { TaskCalendar, TaskTimePicker } from './task-calendar.tsx'
import { cadenceLabel, localDateKey } from './task-labels.ts'
import { productText as text } from './locales/product.ts'

/** Edit a task without changing the active conversation or registering a workspace.
 * @param props - Draft, Host selectors and explicit commit callbacks.
 * @returns Task dialog; changes are draft-only until confirmation.
 */
export function TaskEditor({ draft, change, api, error, titleId, close, save, saving = false }: {
  saving?: boolean
  draft: AutomationTask
  change: (draft: AutomationTask) => void
  api: AutomationApi
  error: string
  titleId: string
  close: () => void
  save: () => void
}) {
  const [workspaces, setWorkspaces] = useState<{ title: string; path: string }[]>([])
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [modelFailed, setModelFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [modelQuery, setModelQuery] = useState('')
  const [selectorError, setSelectorError] = useState('')
  const [picking, setPicking] = useState(false)
  const [connectors, setConnectors] = useState<Awaited<ReturnType<NonNullable<AutomationApi['listConnectors']>>>>([])
  const [connecting, setConnecting] = useState<string | null>(null)
  const [connectorError, setConnectorError] = useState('')
  const [panel, setPanel] = useState<'workspace' | 'permission' | 'model' | 'cadence' | 'time' | 'validity' | 'push' | null>(null)
  const active = useRef(true)
  const current = useRef(draft)
  current.current = draft
  const today = localDateKey(new Date())
  useEffect(() => {
    active.current = true
    void api.listWorkspaces().then((items) => { if (active.current) setWorkspaces(items) }).catch((failure: unknown) => {
      if (active.current) setSelectorError(String(failure))
    })
    void api.listModels().then((value) => {
      if (!active.current) return
      setCatalog(value)
      if (!current.current.model) {
        const next = { ...current.current, model: value.default }
        current.current = next
        change(next)
      }
    }).catch((failure: unknown) => {
      if (active.current) { setSelectorError(String(failure)); setModelFailed(true) }
    })
    return () => { active.current = false }
  }, [api])
  useEffect(() => {
    let disposed = false
    const refresh = () => {
      if (!api.listConnectors) { setConnectorError(text('连接器状态加载失败')); return }
      void api.listConnectors().then((value) => { if (!disposed) { setConnectors(value); setConnectorError('') } })
        .catch(() => { if (!disposed) setConnectorError(text('连接器状态加载失败')) })
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => { disposed = true; window.removeEventListener('focus', refresh) }
  }, [api])
  const chooseFolder = async () => {
    if (picking) return
    setPicking(true); setSelectorError('')
    try {
      const path = await api.chooseDirectory()
      if (active.current && path !== null) { change({ ...current.current, cwd: path }); setPanel(null) }
    } catch (failure) { if (active.current) setSelectorError(String(failure)) }
    finally { if (active.current) setPicking(false) }
  }
  const toggle = (value: NonNullable<typeof panel>) => { setPanel(panel === value ? null : value) }
  const collapse = () => { setPanel(null) }
  const selected = workspaces.find(item => item.path === draft.cwd)
  const modelGroup = catalog?.groups.find(group => group.id === draft.model?.provider)
  const modelName = modelGroup?.models.find(model => model.id === draft.model?.model)?.name
    ?? draft.model?.model ?? text('选择模型')
  const fullAccess = draft.fullAccess !== false
  const cadenceOptions: AutomationTask['cadence'][] = ['interval', 'once', 'daily', 'workdays', 'weekly', 'biweekly', 'monthly', 'yearly']
  const invalidRange = draft.endDate !== undefined && draft.endDate < (draft.startDate ?? today)
  const validity = draft.cadence === 'once' ? draft.startDate ?? today : draft.endDate ? text('至 {0}', [draft.endDate]) : text('长期有效')
  return <div className="dsh-automation-modal-backdrop"><form className="dsh-automation-modal automation-card-dialog automation-task-editor"
    role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={(event) => { event.preventDefault(); collapse(); if (!saving) save() }}
    onKeyDown={(event) => { if (event.key === 'Escape' && !saving) { event.stopPropagation(); if (panel) collapse(); else if (connecting) setConnecting(null); else close() } }}>
    <header><span id={titleId}>{draft.id ? text('编辑任务') : text('新建定时任务')}</span>
      <button type="button" aria-label={text('关闭')} disabled={saving} onClick={close}><IconCloseOutline16 size={20} /></button></header>
    <input autoFocus aria-label={text('任务名称')} required maxLength={80} value={draft.name}
      onChange={(event) => { change({ ...draft, name: event.target.value }) }} placeholder={text('输入任务名称')} />
    <div className="automation-prompt-shell">
      <div className="automation-prompt-card"><textarea aria-label={text('任务说明')} required maxLength={20000} value={draft.prompt}
        onChange={(event) => { change({ ...draft, prompt: event.target.value }) }} placeholder={text('添加提示词')} />
      <div className="automation-prompt-tools"><TaskPopover open={panel === 'model'} close={collapse} label={text('选择模型')} className="automation-model-menu"
        trigger={<button type="button" className="automation-editor-trigger" aria-label={text('选择模型')} aria-expanded={panel === 'model'} onClick={() => { toggle('model') }}><span>{modelName}</span><IconChevronDownOutline14 /></button>}>
        <label className="automation-editor-search"><IconSearchOutline16 /><input autoFocus aria-label={text('搜索模型')} placeholder={text('搜索模型')} value={modelQuery} onChange={(event) => { setModelQuery(event.target.value) }} /></label>
        <div className="automation-editor-options">
          {catalog === null && !modelFailed && <small>{text('正在加载模型')}</small>}
          {catalog?.groups.map(group => <section key={group.id}><small>{group.name}</small>{group.models.filter(model => `${model.name} ${model.id}`.toLowerCase().includes(modelQuery.toLowerCase())).map(model =>
            <button type="button" key={model.id} aria-pressed={draft.model?.provider === group.id && draft.model.model === model.id} onClick={() => { change({ ...draft, model: { provider: group.id, model: model.id } }); collapse() }}><span>{model.name}</span>{draft.model?.provider === group.id && draft.model.model === model.id && <IconCheckOutline16 />}</button>)}</section>)}
          {catalog?.failures.map(failure => <p role="status" key={failure.id}>{failure.name}: {failure.message}</p>)}
        </div>
      </TaskPopover></div>
      </div>
      <div className="automation-workspace-row">
        <TaskPopover open={panel === 'workspace'} close={collapse} label={text('选择工作空间')} className="automation-workspace-menu"
          trigger={<button type="button" className="automation-editor-trigger automation-workspace-trigger" aria-label={text('选择工作空间')} aria-expanded={panel === 'workspace'} title={draft.cwd}
            onClick={() => { toggle('workspace') }}><IconFolderClose16 /><span>{selected?.title ?? (draft.cwd.split(/[\\/]/).filter(Boolean).at(-1) || text('选择工作空间'))}</span><IconChevronDownOutline14 /></button>}>
          <label className="automation-editor-search"><IconSearchOutline16 /><input autoFocus aria-label={text('搜索工作空间')} placeholder={text('搜索工作空间')} value={query} onChange={(event) => { setQuery(event.target.value) }} /></label>
          <div className="automation-editor-options">{workspaces.filter(item => item.title.includes(query) || item.path.includes(query)).map(item =>
            <button type="button" key={item.path} title={item.path} onClick={() => { change({ ...draft, cwd: item.path }); collapse() }}><IconFolderClose16 /><span>{item.title}</span>{draft.cwd === item.path && <IconCheckOutline16 />}</button>)}
          {workspaces.length === 0 && <small>{text('暂无已注册工作空间')}</small>}</div>
          <div className="automation-editor-menu-footer"><button type="button" disabled={picking} onClick={() => { void chooseFolder() }}><IconFolderClose16 />{text('打开本地文件夹')}</button></div>
        </TaskPopover>
        <TaskPopover open={panel === 'permission'} close={collapse} label={text('执行权限')} className="automation-permission-menu"
          trigger={<button type="button" className={`automation-editor-trigger${fullAccess ? ' full-access' : ''}`} aria-expanded={panel === 'permission'} onClick={() => { toggle('permission') }}><IconWarningOutline16 /><span>{fullAccess ? text('允许完全访问') : text('工作区写入')}</span><IconChevronDownOutline14 /></button>}>
          <p>{fullAccess ? text('当前权限为允许完全访问，请注意数据安全，建议执行可信任的任务。') : text('仅允许工作区写入；需要审批的操作可能使定时任务等待人工处理。')}</p>
          <div className="automation-permission-toggle"><span>{text('允许完全访问')}</span><button type="button" role="switch" aria-label={text('允许完全访问')} aria-checked={fullAccess} className={`automation-task-switch${fullAccess ? ' on' : ''}`} onClick={() => { change({ ...draft, fullAccess: !fullAccess }) }} /></div>
        </TaskPopover>

        <TaskPopover open={panel === 'push'} close={collapse} label={text('消息推送')} className="automation-push-menu"
          trigger={<button id="automation-authorization-owner" type="button" className="automation-editor-trigger"
            aria-label={text('消息推送')} aria-expanded={panel === 'push'} onClick={() => { toggle('push') }}>
            <span>{text('消息推送')}{draft.pushChannels?.length ? ` (${draft.pushChannels.length})` : ''}</span>
            <IconChevronDownOutline14 /></button>}>
          {connectors.map((item) => {
            const checked = draft.pushChannels?.includes(item.id) === true
            return <label key={item.id} className="automation-push-option"><span>{text('消息推送到{0}', [item.name])}</span>
              <button type="button" role="switch" aria-label={text('消息推送到{0}', [item.name])} aria-checked={checked}
                className={`automation-task-switch${checked ? ' on' : ''}`} onClick={() => {
                  if (!checked && !item.connected) { collapse(); setConnecting(item.id); return }
                  change({ ...draft, pushChannels: checked
                    ? draft.pushChannels?.filter(id => id !== item.id) : [...draft.pushChannels ?? [], item.id] })
                }} />
            </label>
          })}
          {connectorError && <p role="alert">{connectorError}</p>}
          {!connectors.length && !connectorError && <p role="status">{text('正在加载连接器')}</p>}
        </TaskPopover>
      </div>
    </div>
    <div className="automation-editor-schedule">
      <TaskPopover open={panel === 'cadence'} close={collapse} label={text('重复')} className="automation-cadence-menu"
        trigger={<button type="button" className="automation-schedule-trigger" aria-label={text('触发频率')} aria-expanded={panel === 'cadence'} onClick={() => { toggle('cadence') }}><span>{text('重复：{0}', [cadenceLabel(draft.cadence)])}</span><IconChevronDownOutline14 /></button>}>
        {cadenceOptions.map(value => <button type="button" key={value} onClick={() => { change({ ...draft, cadence: value, startDate: draft.startDate ?? today, ...(value === 'interval' ? { intervalMinutes: draft.intervalMinutes ?? 60 } : {}) }); collapse() }}>{cadenceLabel(value)}{draft.cadence === value && <IconCheckOutline16 />}</button>)}
      </TaskPopover>
      <TaskPopover open={panel === 'time'} close={collapse} label={text('执行时间')} className="automation-time-menu"
        trigger={<button type="button" className="automation-schedule-trigger" aria-label={text('执行时间')} aria-expanded={panel === 'time'} onClick={() => { toggle('time') }}><span>{text('时间：{0}', [draft.time])}</span><IconChevronDownOutline14 /></button>}>
        <TaskTimePicker value={draft.time} change={(time) => { change({ ...draft, time }) }} />
      </TaskPopover>
      <TaskPopover open={panel === 'validity'} close={collapse} label={text('有效期')} className="automation-validity-menu" align="end"
        trigger={<button type="button" className="automation-schedule-trigger" aria-label={text('有效期')} aria-expanded={panel === 'validity'} onClick={() => { toggle('validity') }}><span>{text('有效期：{0}', [validity])}</span><IconChevronDownOutline14 /></button>}>
        <TaskCalendar draft={draft} change={change} close={collapse} />
      </TaskPopover>
    </div>
    {connecting && api.connectionDialog?.(connecting, (connected) => {
      if (connected) {
        const id = connecting as 'feishu' | 'dingtalk' | 'wechat'
        change({ ...current.current, pushChannels: [...new Set([...current.current.pushChannels ?? [], id])] })
        setConnectors(items => items.map(item => item.id === id ? { ...item, connected: true } : item))
      }
      setConnecting(null)
    })}
    {draft.cadence === 'interval' && <label className="automation-interval-field">{text('间隔分钟')}<input type="number" min={1} max={525600} required value={draft.intervalMinutes ?? 60} onChange={(event) => { change({ ...draft, intervalMinutes: event.target.valueAsNumber }) }} /></label>}
    {invalidRange && <p role="alert" className="automation-error">{text('结束日期不能早于开始日期')}</p>}
    {(selectorError || error) && <p role="alert" className="automation-error">{selectorError || error}</p>}
    <footer><button type="button" disabled={saving} onClick={close}>{text('取消')}</button><button type="submit" disabled={saving || picking || invalidRange || !draft.name.trim() || !draft.prompt.trim() || !draft.model}>{text('确定')}</button></footer>
  </form></div>
}
