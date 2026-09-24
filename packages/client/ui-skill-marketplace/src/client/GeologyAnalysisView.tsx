import { useEffect, useState } from 'react'
import css from './GeologyAnalysisView.module.css'
type AnalysisViewReader = { readAnalysisView(path: string): Promise<unknown> }

type AnalysisTable = { id: string; title: string; columns: string[]; rows: string[][] }
type AnalysisView = { title: string; tables: AnalysisTable[]; metrics?: { label: string; value: string }[] }

function parseView(value: unknown): AnalysisView {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value.replace(/^\uFEFF/u, '')) : value
  if (parsed === null || typeof parsed !== 'object') throw new Error('分析视图格式无效')
  const view = parsed as Partial<AnalysisView>
  if (typeof view.title !== 'string' || !Array.isArray(view.tables) || view.tables.length === 0 || !view.tables.every(table =>
    typeof table.id === 'string' && typeof table.title === 'string' && Array.isArray(table.columns) && table.columns.every(column => typeof column === 'string') && Array.isArray(table.rows) && table.rows.every(row => Array.isArray(row) && row.every(cell => typeof cell === 'string')),
  )) throw new Error('分析视图缺少可展示的表格')
  return view as AnalysisView
}

export function GeologyAnalysisView({ path, service }: { path: string; service: AnalysisViewReader }) {
  const [view, setView] = useState<AnalysisView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [visibleRows, setVisibleRows] = useState(100)

  useEffect(() => {
    let active = true
    setView(null)
    setError(null)
    void service.readAnalysisView(path).then((value) => {
      if (!active) return
      const parsed = parseView(value)
      setView(parsed)
      setSelectedId(parsed.tables[0]?.id ?? null)
      setVisibleRows(100)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '分析视图加载失败')
    })
    return () => { active = false }
  }, [path, service])

  if (error !== null) return <section className={css.root}><h3>分析数据表格</h3><p role="alert">表格未能加载：{error}。可打开 Excel 明细查看。</p></section>
  if (view === null) return <section className={css.root}><h3>分析数据表格</h3><p>正在读取本次分析数据…</p></section>
  const selected = view.tables.find(table => table.id === selectedId) ?? view.tables[0]
  if (selected === undefined) return null
  return <section className={css.root} aria-label="分析数据表格">
    <header><span>本次分析视图</span><h3>{view.title}</h3></header>
    {Array.isArray(view.metrics) && view.metrics.length > 0 && <dl className={css.metrics}>{view.metrics.filter(metric => typeof metric.label === 'string' && typeof metric.value === 'string').map(metric => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl>}
    <div className={css.tabs} role="tablist" aria-label="分析数据分类">{view.tables.map(table => <button key={table.id} type="button" role="tab" aria-selected={selected.id === table.id} onClick={() => { setSelectedId(table.id); setVisibleRows(100) }}>{table.title}</button>)}</div>
    <div className={css.tableWrap}><table><thead><tr>{selected.columns.map((column, index) => <th key={`${column}-${index}`}>{column}</th>)}</tr></thead><tbody>{selected.rows.slice(0, visibleRows).map((row, index) => <tr key={`${selected.id}-${index}`}>{selected.columns.map((column, columnIndex) => <td key={`${column}-${columnIndex}`}>{row[columnIndex] ?? '—'}</td>)}</tr>)}</tbody></table></div>
    {selected.rows.length > visibleRows && <button type="button" className={css.more} onClick={() => setVisibleRows(count => count + 100)}>加载更多（已显示 {visibleRows} / {selected.rows.length} 条）</button>}
  </section>
}
