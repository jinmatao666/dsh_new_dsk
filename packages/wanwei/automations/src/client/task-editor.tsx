/** Reviewed task draft with Host workspace and directory selection. */
import { useEffect, useRef, useState } from 'react'
import { Select } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AutomationTask } from '../contract.ts'
import type { AutomationApi } from './task-cards.tsx'
import { productText as text } from './locales/product.ts'

/** Edit a task without changing conversation selection or registering a workspace.
 * @param props - Draft, authenticated selectors and explicit commit callbacks.
 * @returns A task dialog; directory selection alone never saves or executes.
 */
export function TaskEditor({ draft, change, api, error, titleId, close, save }: {
  draft: AutomationTask
  change: (draft: AutomationTask) => void
  api: AutomationApi
  error: string
  titleId: string
  close: () => void
  save: () => void
}) {
  const [workspaces, setWorkspaces] = useState<{ title: string; path: string }[]>([])
  const [query, setQuery] = useState('')
  const [pickerError, setPickerError] = useState('')
  const [picking, setPicking] = useState(false)
  const active = useRef(true)
  const picker = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    active.current = true
    void api.listWorkspaces().then((items) => { if (active.current) setWorkspaces(items) }).catch((failure: unknown) => {
      if (active.current) setPickerError(String(failure))
    })
    return () => { active.current = false }
  }, [api])
  const chooseFolder = async () => {
    if (picking) return
    setPicking(true); setPickerError('')
    try {
      const path = await api.chooseDirectory()
      if (active.current && path !== null) { change({ ...draft, cwd: path }); picker.current?.removeAttribute('open') }
    } catch (failure) { if (active.current) setPickerError(String(failure)) }
    finally { if (active.current) setPicking(false) }
  }
  const selected = workspaces.find(item => item.path === draft.cwd)
  return <div className="dsh-automation-modal-backdrop"><form className="dsh-automation-modal automation-card-dialog automation-task-editor"
    role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={(event) => { event.preventDefault(); save() }}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
    <header><span id={titleId}>{draft.id ? text('编辑任务') : text('新建定时任务')}</span>
      <button type="button" aria-label={text('关闭')} onClick={close}>×</button></header>
    <input autoFocus aria-label={text('任务名称')} required maxLength={80} value={draft.name}
      onChange={(event) => { change({ ...draft, name: event.target.value }) }} placeholder={text('输入任务名称')} />
    <div className="automation-prompt-shell">
      <div className="automation-prompt-card"><textarea aria-label={text('任务说明')} required maxLength={20000} value={draft.prompt}
        onChange={(event) => { change({ ...draft, prompt: event.target.value }) }} placeholder={text('添加提示词')} />
      <span className="automation-model-label">{text('默认模型')}</span></div>
      <div className="automation-workspace-row">
        <details ref={picker} className="automation-workspace-picker">
          <summary title={draft.cwd}>{selected?.title ?? (draft.cwd || text('选择工作空间'))} ⌄</summary>
          <div className="automation-workspace-menu">
            <input aria-label={text('搜索工作空间')} placeholder={text('搜索工作空间')} value={query} onChange={(event) => { setQuery(event.target.value) }} />
            <div className="automation-workspace-options">{workspaces.filter(item => item.title.includes(query) || item.path.includes(query)).map(item =>
              <button type="button" key={item.path} title={item.path} onClick={() => { change({ ...draft, cwd: item.path }); picker.current?.removeAttribute('open') }}>▱ {item.title}</button>)}
            {workspaces.length === 0 && <small>{text('暂无已注册工作空间')}</small>}</div>
            <button type="button" disabled={picking} onClick={() => { void chooseFolder() }}>{text('打开本地文件夹')}</button>
            <label>{text('工作目录')}<input value={draft.cwd} placeholder={text('填写本机工作目录的绝对路径')} onChange={(event) => { change({ ...draft, cwd: event.target.value }) }} /></label>
          </div>
        </details>
        <span className="automation-permission-label">{text('工作区写入')}</span>
      </div>
    </div>
    <div className="automation-editor-schedule">
      <label><span>{text('重复')}</span><Select label={text('触发频率')} value={draft.cadence} onChange={(value) => { change({ ...draft, cadence: value as AutomationTask['cadence'] }) }}
        options={[{ value: 'daily', label: text('每天') }, { value: 'workdays', label: text('每个工作日') }, { value: 'friday', label: text('每周五') }]} /></label>
      <label><span>{text('时间')}</span><input aria-label={text('执行时间')} type="time" required value={draft.time} onChange={(event) => { change({ ...draft, time: event.target.value }) }} /></label>
      <div className="automation-validity"><span>{text('有效期')}</span>{text('长期有效')}</div>
    </div>
    <label className="automation-draft-switch"><input type="checkbox" checked={draft.enabled} onChange={(event) => { change({ ...draft, enabled: event.target.checked }) }} />{text('保存后启用')}</label>
    <small className="automation-approval-note">{text('需要人工确认的操作仍须在会话中处理。')}</small>
    {(pickerError || error) && <p role="alert" className="automation-error">{pickerError || error}</p>}
    <footer><button type="button" onClick={close}>{text('取消')}</button><button type="submit" disabled={picking || !draft.name.trim() || !draft.prompt.trim() || !draft.cwd.trim()}>{text('保存任务')}</button></footer>
  </form></div>
}
