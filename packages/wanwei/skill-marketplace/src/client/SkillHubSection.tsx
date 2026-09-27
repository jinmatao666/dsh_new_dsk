import { productText } from './locales/product.ts'
import { useEffect, useRef, useState } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import './skillhub.css'

type Skill = {
  slug: string
  name: string
  summary: string
  version: string
  author: string
  category: string
  paid: boolean
  requiresApiKey: boolean
}
type Installed = Pick<Skill, 'slug' | 'name' | 'summary' | 'version'> & { source: 'skillhub'; localSlug: string; sha256: string }
type Page = { items: Skill[]; total: number; pageSize: number }
/** Only product-owned RPC and native commands cross this presentation boundary. */
export interface SkillHubSectionProps {
  active: boolean
  installedOnly: boolean
  installedQuery?: string
  request: (operation: string, payload: unknown) => Promise<unknown>
  invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>
  onUse: (slug: string, name: string) => void
  onCount: (count: number) => void
}
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
const markdownLabels = { code: { copyLabel: productText('复制'), copiedLabel: productText('已复制') }, footnotes: productText('脚注') }

/** Isolated remote catalog; local receipts remain available without the upstream. */
export function SkillHubSection({ active, installedOnly, installedQuery = '', request, invoke, onUse, onCount }: SkillHubSectionProps) {
  const [keyword, setKeyword] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [sort, setSort] = useState('downloads')
  const [page, setPage] = useState(1)
  const [retry, setRetry] = useState(0)
  const [data, setData] = useState<Page>({ items: [], total: 0, pageSize: 12 })
  const [categories, setCategories] = useState<{ key: string; name: string }[]>([])
  const [installed, setInstalled] = useState<Installed[]>([])
  const [localReady, setLocalReady] = useState(false)
  const [localError, setLocalError] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<Skill | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const generation = useRef(0)
  const detailGeneration = useRef(0)
  const latest = useRef({ onCount, onUse })
  latest.current = { onCount, onUse }

  const refreshLocal = async () => {
    const value = await invoke('list_skillhub_skills', {})
    if (!Array.isArray(value)) throw new Error('本地技能列表格式无效')
    const items = value as Installed[]
    setInstalled(items)
    setLocalReady(true)
    setLocalError('')
    latest.current.onCount(items.length)
  }

  useEffect(() => {
    if (!active) return
    let disposed = false
    const refresh = () => {
      void invoke('list_skillhub_skills', {}).then((value) => {
        if (disposed) return
        if (!Array.isArray(value)) throw new Error('本地技能列表格式无效')
        setInstalled(value as Installed[])
        setLocalReady(true)
        setLocalError('')
        latest.current.onCount(value.length)
      }).catch((e: unknown) => { if (!disposed) { setLocalReady(false); setLocalError(errorText(e)) } })
    }
    refresh()
    window.addEventListener('dsh:skills-changed', refresh)
    return () => { disposed = true; window.removeEventListener('dsh:skills-changed', refresh) }
  }, [active, invoke, retry])

  useEffect(() => {
    if (!active || installedOnly) return
    let disposed = false
    void request('categories', {}).then((value) => {
      if (!disposed) setCategories((value as { items: { key: string; name: string }[] }).items)
    }).catch(() => { /* The searchable list remains usable if optional categories fail. */ })
    return () => { disposed = true }
  }, [active, installedOnly, request, retry])

  useEffect(() => {
    if (!active || installedOnly) return
    const current = ++generation.current
    setLoading(true)
    setError('')
    void request('list', { keyword: query, category, sort, page }).then((value) => {
      if (current === generation.current) setData(value as Page)
    }).catch((e: unknown) => { if (current === generation.current) setError(errorText(e)) })
      .finally(() => { if (current === generation.current) setLoading(false) })
    return () => { generation.current++ }
  }, [active, installedOnly, query, category, sort, page, retry, request])

  useEffect(() => {
    detailGeneration.current++
    setSelected(null)
    setDetailLoading(false)
    return () => { detailGeneration.current++ }
  }, [active, installedOnly])

  const openDetail = async (skill: Skill) => {
    const current = ++detailGeneration.current
    setNotice('')
    if (installedOnly) { setSelected(skill); return }
    setDetailLoading(true)
    try {
      const value = await request('detail', { slug: skill.slug })
      if (current === detailGeneration.current) setSelected(value as Skill)
    } catch (e) { if (current === detailGeneration.current) setNotice(errorText(e)) }
    finally { if (current === detailGeneration.current) setDetailLoading(false) }
  }

  const operate = async (skill: Skill, record?: Installed) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setNotice(record ? '正在卸载…' : '正在下载…')
    let committed = false
    try {
      if (record) {
        await invoke('uninstall_skillhub_skill', { slug: record.slug, localSlug: record.localSlug })
        setInstalled(items => items.filter(item => item.localSlug !== record.localSlug))
      } else {
        const bundle = await request('download', { slug: skill.slug, version: skill.version }) as { archive: string; sha256: string; slug: string; version: string }
        setNotice('正在安装…')
        const value = await invoke('install_skillhub_skill', {
          archive: bundle.archive,
          record: { source: 'skillhub', slug: bundle.slug, localSlug: '', version: bundle.version, name: skill.name, summary: skill.summary, sha256: bundle.sha256 },
        }) as Installed
        setInstalled(items => [...items.filter(item => item.localSlug !== value.localSlug), value])
      }
      committed = true
      await refreshLocal()
      setNotice(record ? '技能已卸载' : '技能已安装，可以开始使用')
      if (record && installedOnly) setSelected(null)
    } catch (e) { setNotice(`${committed ? '操作已完成，但列表刷新失败：' : ''}${errorText(e)}`) }
    finally { pending.current = false; setBusy(false) }
  }
  const ownRecord = (skill: Skill) => installed.find(item => item.slug === skill.slug)
  const cards: Skill[] = installedOnly
    ? installed.filter(item => `${item.name} ${item.summary}`.toLowerCase().includes(installedQuery.toLowerCase()))
      .map(item => ({ ...item, author: '', category: '', paid: false, requiresApiKey: false }))
    : data.items

  if (!active) return null
  return <section className="wanwei-skillhub" aria-label={productText('SkillHub 技能')}>
    <div className="dsh-skill-section-header"><h2>{productText('SkillHub 技能')}</h2><span className="wanwei-skillhub-source">{installedOnly ? productText('本机已安装') : productText('来自腾讯 SkillHub')}</span></div>
    {localError && <div role="status" className="wanwei-skillhub-status">{productText('本地安装状态暂不可用：')}{localError}<button type="button" onClick={() => { setRetry(v => v + 1) }}>{productText('重试')}</button></div>}
    {notice && <p role="status" className="wanwei-skillhub-status">{notice}</p>}
    {detailLoading && <p role="status">{productText('正在读取技能详情…')}</p>}
    {selected ? <div className="wanwei-skillhub-detail">
      <button type="button" onClick={() => { setSelected(null) }} disabled={busy}>{productText('返回 SkillHub 列表')}</button>
      <h3>{selected.name}</h3>
      <div className="wanwei-skillhub-summary"><MarkdownText text={selected.summary} labels={markdownLabels} /></div>
      <dl><dt>{productText('作者')}</dt><dd>{selected.author || productText('未提供')}</dd><dt>{productText('版本')}</dt><dd>{selected.version}</dd><dt>{productText('来源')}</dt><dd>{productText('SkillHub')}</dd></dl>
      {selected.requiresApiKey && <p>{productText('此技能需要配置外部服务的 API Key。')}</p>}
      {selected.paid && <p>{productText('此技能需要购买，暂不支持在这里安装。')}</p>}
      {ownRecord(selected) ? <div className="wanwei-skillhub-actions">
        <button type="button" disabled={busy} onClick={() => { const item = ownRecord(selected); if (item) latest.current.onUse(item.localSlug, item.name) }}>{productText('使用技能')}</button>
        <button type="button" disabled={busy} onClick={() => { void operate(selected, ownRecord(selected)) }}>{productText('卸载')}</button>
        <span>{productText('已安装 v')}{ownRecord(selected)?.version}</span>
      </div> : <button type="button" disabled={busy || !localReady || selected.paid} onClick={() => { void operate(selected) }}>{busy ? productText('处理中…') : productText('安装')}</button>}
    </div> : <>
      {!installedOnly && <form className="wanwei-skillhub-filters" onSubmit={(e) => { e.preventDefault(); setQuery(keyword.trim()); setPage(1); setRetry(v => v + 1) }}>
        <input aria-label={productText('搜索 SkillHub 技能')} placeholder={productText('搜索 SkillHub 技能')} value={keyword} maxLength={200} onChange={(e) => { setKeyword(e.target.value) }} />
        <button type="submit">{productText('搜索')}</button>
        <select aria-label={productText('SkillHub 分类')} value={category} onChange={(e) => { setCategory(e.target.value); setPage(1) }}><option value="">{productText('全部分类')}</option>{categories.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}</select>
        <select aria-label={productText('SkillHub 排序')} value={sort} onChange={(e) => { setSort(e.target.value); setPage(1) }}><option value="downloads">{productText('热门下载')}</option><option value="updated_at">{productText('最近更新')}</option></select>
      </form>}
      {!installedOnly && loading ? <p role="status">{productText('正在加载 SkillHub 技能…')}</p> : !installedOnly && error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => { setRetry(v => v + 1) }}>{productText('重试')}</button></div> : <>
        <div className="dsh-skill-grid">{cards.map(skill => <article className="dsh-skill-card" key={skill.slug}>
          <button className="wanwei-skillhub-card-title" type="button" onClick={() => { void openDetail(skill) }}>{skill.name}</button>
          <p className="wanwei-skillhub-card-summary">{skill.summary}</p>
          <div className="wanwei-skillhub-card-meta"><span>{productText('SkillHub')}</span><span>{productText('v')}{skill.version}</span>{ownRecord(skill) && <span>{productText('已安装')}</span>}</div>
          <div className="wanwei-skillhub-actions"><button type="button" onClick={() => { void openDetail(skill) }}>{productText('查看详情')}</button>{ownRecord(skill) && <button type="button" disabled={busy} onClick={() => { const item = ownRecord(skill); if (item) latest.current.onUse(item.localSlug, item.name) }}>{productText('使用技能')}</button>}</div>
        </article>)}</div>
        {cards.length === 0 && <p>{installedOnly ? productText('暂未安装 SkillHub 技能') : productText('没有找到相关技能，试试其他关键词或分类。')}</p>}
        {!installedOnly && <div className="wanwei-skillhub-pagination"><button type="button" disabled={page <= 1} onClick={() => { setPage(v => v - 1) }}>{productText('上一页')}</button><span>{productText('第')}{page} {productText(' 页')}</span><button type="button" disabled={page * data.pageSize >= data.total} onClick={() => { setPage(v => v + 1) }}>{productText('下一页')}</button></div>}
      </>}
    </>}
  </section>
}
