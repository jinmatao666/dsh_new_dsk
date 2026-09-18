import { useEffect, useState } from 'react'
import css from './AnalysisResultCard.module.css'

interface AnalysisTable { id: string; title: string; columns: string[]; rows: string[][] }
interface AnalysisMetric { label: string; value: string }
interface AnalysisSection { title: string; items: string[]; kind?: 'analysis' | 'conclusion' | 'advice' }
interface AnalysisView {
  schema_version: number
  title: string
  generated_at: string
  metrics?: AnalysisMetric[]
  sections?: AnalysisSection[]
  tables: AnalysisTable[]
}

type NativeInvoke = (command: string, args?: unknown) => Promise<unknown>

function nativeInvoke(): NativeInvoke | undefined {
  const desktop = window as Window & {
    __ZJUGIS_NATIVE_INVOKE__?: NativeInvoke
    __TAURI__?: { core?: { invoke?: NativeInvoke } }
    __TAURI_INTERNALS__?: { invoke?: NativeInvoke }
  }
  return desktop.__ZJUGIS_NATIVE_INVOKE__
    ?? desktop.__TAURI__?.core?.invoke
    ?? desktop.__TAURI_INTERNALS__?.invoke
}

function isAnalysisView(value: unknown): value is AnalysisView {
  if (value === null || typeof value !== 'object') return false
  const record = value as Partial<AnalysisView>
  return typeof record.title === 'string'
    && Array.isArray(record.tables)
    && record.tables.every(table => Array.isArray(table.columns) && Array.isArray(table.rows))
}

function Section({ section }: { section: AnalysisSection }) {
  return (
    <section className={section.kind === 'conclusion' ? css.conclusion : css.section}>
      <h4>{section.title}</h4>
      <ul>{section.items.map(item => <li key={item}>{item}</li>)}</ul>
    </section>
  )
}

/** Render a local GIS analysis-view JSON next to its formal office deliverables. */
export function AnalysisResultCard({
  path, openFile, excelPath, wordPath,
}: {
  path: string
  openFile: (path: string) => void
  excelPath: string | undefined
  wordPath: string | undefined
}) {
  const [view, setView] = useState<AnalysisView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [visibleRows, setVisibleRows] = useState(100)

  useEffect(() => {
    const invoke = nativeInvoke()
    if (invoke === undefined) {
      setError('当前环境不能读取本地分析视图，可直接打开 Excel 或 Word 成果。')
      return
    }
    let active = true
    setView(null)
    setError(null)
    void invoke('read_analysis_view', { path }).then((value) => {
      if (!active) return
      if (typeof value !== 'string') throw new Error('分析视图返回格式无效')
      const parsed: unknown = JSON.parse(value.replace(/^\uFEFF/u, ''))
      if (!isAnalysisView(parsed) || parsed.tables.length === 0) throw new Error('分析视图缺少可展示的表格')
      setView(parsed)
      setSelectedId(parsed.tables[0]?.id ?? null)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '分析视图加载失败')
    })
    return () => { active = false }
  }, [path])

  const actions = (
    <div className={css.actions}>
      {excelPath !== undefined && <button type="button" onClick={() => { openFile(excelPath) }}>打开 Excel</button>}
      {wordPath !== undefined && <button type="button" onClick={() => { openFile(wordPath) }}>打开 Word</button>}
    </div>
  )
  if (view === null) {
    return (
      <section className={css.root} aria-label="分析结果">
        <div className={css.heading}><div><div className={css.kicker}>分析结果</div><h3>{error ?? '正在加载分析成果…'}</h3></div>{actions}</div>
      </section>
    )
  }
  const selected = view.tables.find(table => table.id === selectedId) ?? view.tables[0]
  if (selected === undefined) return null
  return (
    <section className={css.root} aria-label={`${view.title}结果表格`}>
      <div className={css.heading}><div><div className={css.kicker}>空间分析成果</div><h3>{view.title}</h3></div>{actions}</div>
      {view.metrics !== undefined && (
        <dl className={css.metrics}>
          {view.metrics.map(metric => (
            <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>
          ))}
        </dl>
      )}
      <div className={css.tabs} role="tablist" aria-label="分析数据分类">
        {view.tables.map(table => <button key={table.id} type="button" role="tab" aria-selected={selected.id === table.id} className={selected.id === table.id ? css.tabActive : css.tab} onClick={() => { setSelectedId(table.id); setVisibleRows(100) }}>{table.title}</button>)}
      </div>
      <div className={css.tableWrap}><table><thead><tr>{selected.columns.map((column, index) => <th key={`${column}-${index}`}>{column}</th>)}</tr></thead><tbody>{selected.rows.slice(0, visibleRows).map((row, index) => <tr key={`${selected.id}-${index}`}>{selected.columns.map((column, columnIndex) => <td key={`${column}-${columnIndex}`}>{row[columnIndex] ?? '—'}</td>)}</tr>)}</tbody></table></div>
      {selected.rows.length > visibleRows && <button type="button" className={css.expand} onClick={() => { setVisibleRows(count => count + 100) }}>加载更多（已显示 {visibleRows} / {selected.rows.length} 条）</button>}
      {view.sections !== undefined && (
        <div className={css.sections}>
          {view.sections.map(section => <Section key={section.title} section={section} />)}
        </div>
      )}
    </section>
  )
}
