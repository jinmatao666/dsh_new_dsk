/** Actual run records displayed as an independently filtered ledger. */
import { useState, type ReactNode } from 'react'
import { Select } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AutomationRun } from '../contract.ts'
import { productText as text } from './locales/product.ts'
import { AutomationSearch } from './search.tsx'

const statusLabel = (status: AutomationRun['status']) => status === 'running' ? text('执行中')
  : status === 'success' ? text('已完成') : status === 'interrupted' ? text('已中断') : text('执行失败')

/** Display real timing, status, errors and Session links without fabricating artifacts.
 * @param props - Committed records and existing execution controls.
 * @returns Filterable record table.
 */
export function RunHistory({ runs, openSession, remove, heading }: {
  runs: AutomationRun[]
  openSession: (id: string) => void
  remove: (id: string) => void
  heading?: ReactNode
}) {
  const [status, setStatus] = useState('all')
  const [trigger, setTrigger] = useState('all')
  const [task, setTask] = useState('all')
  const [query, setQuery] = useState('')
  const filtered = runs.filter(run => (status === 'all' || run.status === status) && (trigger === 'all' || run.trigger === trigger)
    && (task === 'all' || run.taskId === task) && run.taskName.includes(query))
  const taskOptions = [...new Map(runs.map(run => [run.taskId, { value: run.taskId, label: run.taskName }])).values()]
  return <section className="automation-history">
    <header className="automation-card-toolbar automation-history-toolbar">
      {heading}
      <div className="automation-history-filters">
        <AutomationSearch label={text('搜索运行记录')} query={query} change={setQuery} />
        <Select label={text('运行状态')} value={status} onChange={setStatus} options={[{ value: 'all', label: text('全部状态') }, ...(['running', 'success', 'failed', 'interrupted'] as const).map(value => ({ value, label: statusLabel(value) }))]} />
        <Select label={text('执行方式')} value={trigger} onChange={setTrigger} options={[{ value: 'all', label: text('全部类型') }, { value: 'manual', label: text('手动执行') }, { value: 'scheduled', label: text('定时执行') }]} />
        <Select label={text('任务筛选')} value={task} onChange={setTask} options={[{ value: 'all', label: text('全部任务') }, ...taskOptions]} />
      </div>
    </header>
    <div className="automation-history-scroll"><table>
      <colgroup><col className="automation-col-name" /><col /><col className="automation-col-time" /><col /><col /><col /></colgroup>
      <thead><tr>{(['任务名称', '状态', '运行时间', '耗时', '任务类型', '操作'] as const).map(label => <th key={label}>{text(label)}</th>)}</tr></thead>
      <tbody>{filtered.map(run => <tr key={run.id} className={run.sessionId ? 'automation-run-openable' : ''}
        tabIndex={run.sessionId ? 0 : undefined}
        onClick={() => { if (run.sessionId) openSession(run.sessionId) }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || !run.sessionId || (event.key !== 'Enter' && event.key !== ' ')) return
          event.preventDefault(); openSession(run.sessionId)
        }}>
        <td><strong title={run.taskName}>{run.taskName}</strong>{run.error && <details className="automation-run-error" onClick={(event) => { event.stopPropagation() }}><summary>{text('查看失败原因')}</summary><p>{run.error}</p></details>}</td>
        <td><span className={`automation-run-status ${run.status}`}><i aria-hidden="true" />{statusLabel(run.status)}</span></td>
        <td>{new Date(run.startedAt).toLocaleString()}</td>
        <td>{run.endedAt === undefined ? (run.status === 'running' ? text('执行中') : '—') : text('{0} 秒', [Math.max(0, Math.round((run.endedAt - run.startedAt) / 1000))])}</td>
        <td>{text('本地')}</td>
        <td><div className="automation-run-actions"><button type="button" disabled={run.status === 'running'}
          aria-label={text('删除运行记录 {0}', [run.taskName])}
          title={run.status === 'running' ? text('执行中的记录暂不可删除') : text('删除运行记录')}
          onClick={(event) => { event.stopPropagation(); remove(run.id) }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></svg>
        </button></div></td>
      </tr>)}</tbody>
    </table></div>
    {!filtered.length && <div className="dsh-automation-empty"><h2>{runs.length ? text('没有符合条件的记录') : text('暂无真实运行记录')}</h2></div>}
  </section>
}
