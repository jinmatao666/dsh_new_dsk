/** Actual run records displayed as an independently filtered ledger. */
import { useState } from 'react'
import { Select } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AutomationRun } from '../contract.ts'
import { productText as text } from './locales/product.ts'

const statusLabel = (status: AutomationRun['status']) => status === 'running' ? text('执行中')
  : status === 'success' ? text('已完成') : status === 'interrupted' ? text('已中断') : text('执行失败')

/** Display real timing, status, errors and Session links without fabricating artifacts.
 * @param props - Committed records and existing execution controls.
 * @returns Filterable record table.
 */
export function RunHistory({ runs, openSession, stop }: {
  runs: AutomationRun[]
  openSession: (id: string) => void
  stop: (id: string) => void
}) {
  const [status, setStatus] = useState('all')
  const [trigger, setTrigger] = useState('all')
  const [task, setTask] = useState('all')
  const [query, setQuery] = useState('')
  const filtered = runs.filter(run => (status === 'all' || run.status === status) && (trigger === 'all' || run.trigger === trigger)
    && (task === 'all' || run.taskId === task) && run.taskName.includes(query))
  const taskOptions = [...new Map(runs.map(run => [run.taskId, { value: run.taskId, label: run.taskName }])).values()]
  return <section className="automation-history">
    <div className="automation-history-filters">
      <input aria-label={text('搜索运行记录')} placeholder={text('搜索运行记录')} value={query} onChange={(event) => { setQuery(event.target.value) }} />
      <Select label={text('运行状态')} value={status} onChange={setStatus} options={[{ value: 'all', label: text('全部状态') }, ...(['running', 'success', 'failed', 'interrupted'] as const).map(value => ({ value, label: statusLabel(value) }))]} />
      <Select label={text('执行方式')} value={trigger} onChange={setTrigger} options={[{ value: 'all', label: text('全部类型') }, { value: 'manual', label: text('手动执行') }, { value: 'scheduled', label: text('定时执行') }]} />
      <Select label={text('任务筛选')} value={task} onChange={setTask} options={[{ value: 'all', label: text('全部任务') }, ...taskOptions]} />
    </div>
    <div className="automation-history-scroll"><table>
      <thead><tr>{(['任务名称', '状态', '运行时间', '耗时', '任务类型', '操作'] as const).map(label => <th key={label}>{text(label)}</th>)}</tr></thead>
      <tbody>{filtered.map(run => <tr key={run.id}>
        <td><strong>{run.taskName}</strong>{run.error && <details className="automation-run-error"><summary>{text('查看失败原因')}</summary><p>{run.error}</p></details>}</td>
        <td><span className={`automation-run-status ${run.status}`}><i aria-hidden="true" />{statusLabel(run.status)}</span></td>
        <td>{new Date(run.startedAt).toLocaleString()}</td>
        <td>{run.endedAt === undefined ? (run.status === 'running' ? text('执行中') : '—') : text('{0} 秒', [Math.max(0, Math.round((run.endedAt - run.startedAt) / 1000))])}</td>
        <td>{text('本地')}<small className="automation-trigger">{run.trigger === 'manual' ? text('手动执行') : text('定时执行')}</small></td>
        <td><div className="automation-run-actions">{run.sessionId && <button type="button" onClick={() => { if (run.sessionId) openSession(run.sessionId) }}>{text('查看会话与产物')}</button>}
          {run.status === 'running' && <button type="button" onClick={() => { stop(run.id) }}>{text('停止执行')}</button>}</div></td>
      </tr>)}</tbody>
    </table></div>
    {!filtered.length && <div className="dsh-automation-empty"><h2>{runs.length ? text('没有符合条件的记录') : text('暂无真实运行记录')}</h2></div>}
  </section>
}
