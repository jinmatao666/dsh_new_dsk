import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { KnowledgeBaseItem, KnowledgeCategory } from './KnowledgePage.tsx'
import { libraryNavGroups } from './library-groups.ts'
import { productText } from './locales/product.ts'
import type { RetrievalSelection } from './retrieval-selection.ts'

/** Libraries and categories the picker groups like the knowledge page sidebar. */
export interface KnowledgeCatalog {
  items: KnowledgeBaseItem[]
  categories: KnowledgeCategory[]
}

/** Plugin-owned values injected into the composer knowledge toggle. */
export interface KnowledgeToggleInjected {
  hooks: {
    selection: HostObservable<RetrievalSelection>
    /** Whether the deployment exposes knowledge libraries on the current network. */
    visible: HostObservable<boolean>
  }
  /** Replace the toggle state and selected library ids. */
  setSelection: (next: RetrievalSelection) => void
  /** Load the caller's accessible libraries. */
  loadCatalog: () => Promise<KnowledgeCatalog>
  /** Tell the Host which libraries this Session's next model turns retrieve from; empty turns retrieval off. */
  syncScope: (sessionId: string, ids: readonly number[]) => Promise<void>
  /** Open the knowledge-library panel. */
  openLibrary: () => void
}

/** Full props of the composer knowledge toggle. */
export type KnowledgeToggleProps = PropsRuntime<'conversation.composer.tools'> & InjectFace<KnowledgeToggleInjected>

const MAX_SELECTED = 20
const MENU_WIDTH = 380
/** First paint and each “load more” chunk for the picker list. */
const LIST_CHUNK = 40

/**
 * Composer switch that scopes model answers to selected knowledge libraries.
 * Off hides every library control and clears the Session scope so ordinary turns are unchanged.
 */
export function KnowledgeComposerToggle({
  sessionId, useSelection, useVisible, setSelection, loadCatalog, syncScope, openLibrary,
}: KnowledgeToggleProps) {
  const selection = useSelection(value => value)
  const visible = useVisible(value => value)
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<KnowledgeCatalog | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [activeGroup, setActiveGroup] = useState('')
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(LIST_CHUNK)
  const [tabOverflow, setTabOverflow] = useState({ start: false, end: false, scrollable: false })
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLElement | null>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const loadGeneration = useRef(0)

  const scopeKey = selection.enabled && visible ? selection.ids.join(',') : ''
  useEffect(() => {
    if (sessionId === undefined) return
    let cancelled = false
    syncScope(String(sessionId), scopeKey === '' ? [] : scopeKey.split(',').map(Number))
      .then(() => { if (!cancelled) setSyncError('') })
      .catch((reason: unknown) => {
        if (!cancelled) setSyncError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => { cancelled = true }
  }, [sessionId, scopeKey, syncScope])

  const load = () => {
    const generation = loadGeneration.current + 1
    loadGeneration.current = generation
    setLoading(true)
    setError('')
    void loadCatalog()
      .then((next) => {
        if (loadGeneration.current !== generation) return
        setCatalog(next)
        const known = new Set(next.items.map(item => item.id))
        const current = selection.ids.filter(id => known.has(id))
        if (current.length !== selection.ids.length) setSelection({ enabled: selection.enabled, ids: current })
      })
      .catch((reason: unknown) => {
        if (loadGeneration.current !== generation) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (loadGeneration.current === generation) setLoading(false)
      })
  }

  useEffect(() => {
    // Warm the catalog asynchronously when the switch turns on so the picker is ready.
    if (selection.enabled && catalog === null && !loading) load()
  }, [selection.enabled])

  const groups = useMemo(
    () => catalog === null ? [] : libraryNavGroups(catalog.items, catalog.categories),
    [catalog],
  )
  const currentGroup = groups.find(group => group.key === activeGroup) ?? groups[0]
  const selected = useMemo(() => new Set(selection.ids), [selection.ids])
  const names = useMemo(() => {
    const byId = new Map((catalog?.items ?? []).map(item => [item.id, item.name]))
    return selection.ids.flatMap((id) => {
      const name = byId.get(id)
      return name === undefined ? [] : [name]
    })
  }, [catalog, selection.ids])
  const keyword = query.trim().toLowerCase()
  const rows = useMemo(() => (currentGroup?.rows ?? []).filter(item => keyword === ''
    || item.name.toLowerCase().includes(keyword) || item.description.toLowerCase().includes(keyword)),
  [currentGroup, keyword])
  const shownRows = rows.slice(0, visibleCount)
  const hasMore = shownRows.length < rows.length

  useEffect(() => {
    setVisibleCount(LIST_CHUNK)
  }, [currentGroup?.key, keyword])

  useLayoutEffect(() => {
    const tabs = tabsRef.current
    if (!open || tabs === null) return
    const update = () => {
      // Ignore sub-pixel / scrollbar gutter noise so a full-fitting row stays scrollbar-free.
      const max = Math.max(0, tabs.scrollWidth - tabs.clientWidth)
      const scrollable = max > 4
      setTabOverflow({
        scrollable,
        start: scrollable && tabs.scrollLeft > 2,
        end: scrollable && tabs.scrollLeft < max - 2,
      })
    }
    update()
    tabs.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      tabs.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [open, groups.length])

  useEffect(() => {
    if (!open || !hasMore) return
    const target = moreRef.current
    if (target === null || typeof IntersectionObserver !== 'function') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisibleCount(count => Math.min(rows.length, count + LIST_CHUNK))
      }
    }, { root: target.closest('.dsh-kb-picker-list'), rootMargin: '48px' })
    observer.observe(target)
    return () => { observer.disconnect() }
  }, [open, hasMore, shownRows.length, rows.length])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!open || root === null) return
    const place = () => {
      const rect = root.getBoundingClientRect()
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - MENU_WIDTH - 8)
      setMenuStyle({ position: 'fixed', left, bottom: window.innerHeight - rect.top + 10, width: MENU_WIDTH, zIndex: 40 })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const openPicker = () => {
    setQuery('')
    setOpen(true)
    load()
  }
  const toggleEnabled = () => {
    if (selection.enabled) {
      setOpen(false)
      setSelection({ enabled: false, ids: selection.ids })
      return
    }
    setSelection({ enabled: true, ids: selection.ids })
    if (selection.ids.length === 0) openPicker()
  }
  const toggleItem = (id: number) => {
    if (selected.has(id)) {
      setSelection({ enabled: true, ids: selection.ids.filter(value => value !== id) })
    } else if (selection.ids.length < MAX_SELECTED) {
      setSelection({ enabled: true, ids: [...selection.ids, id] })
    }
  }
  const groupIds = (currentGroup?.rows ?? []).map(item => item.id)
  const groupAllSelected = groupIds.length > 0 && groupIds.every(id => selected.has(id))
  const toggleGroup = () => {
    if (groupAllSelected) {
      const remove = new Set(groupIds)
      setSelection({ enabled: true, ids: selection.ids.filter(id => !remove.has(id)) })
      return
    }
    const next = [...selection.ids]
    for (const id of groupIds) if (!selected.has(id) && next.length < MAX_SELECTED) next.push(id)
    setSelection({ enabled: true, ids: next })
  }

  if (!visible) return null

  const onlyName = selection.ids.length === 1 ? names[0] : undefined
  const pickLabel = selection.ids.length === 0
    ? productText('选择知识库')
    : onlyName ?? productText('已选 {count} 个').replace('{count}', String(selection.ids.length))

  return (
    <div ref={rootRef} className={selection.enabled ? 'dsh-kb-toggle is-on' : 'dsh-kb-toggle'}>
      <button
        type="button"
        role="switch"
        aria-checked={selection.enabled}
        className="dsh-kb-toggle-switch"
        title={productText('开启后，模型会先检索所选知识库再回答')}
        onClick={toggleEnabled}
      >
        <BookGlyph />
        <span className="dsh-kb-toggle-label">{productText('知识库')}</span>
        <span className="dsh-kb-toggle-track" aria-hidden="true"><span /></span>
      </button>
      {selection.enabled && (
        <button
          type="button"
          className={selection.ids.length === 0 ? 'dsh-kb-toggle-pick is-empty' : 'dsh-kb-toggle-pick'}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={syncError !== '' ? syncError : names.join('、')}
          onClick={() => { if (open) setOpen(false); else openPicker() }}
        >
          {syncError !== '' && <span className="dsh-kb-toggle-warn" aria-hidden="true">!</span>}
          <span className="dsh-kb-toggle-pick-text">{pickLabel}</span>
          <ChevronGlyph />
        </button>
      )}
      {open && selection.enabled && createPortal(
        <div ref={menuRef} className="dsh-kb-picker" role="dialog" aria-label={productText('选择知识库')} style={menuStyle}>
          <header className="dsh-kb-picker-head">
            <span className="dsh-kb-picker-mark"><BookGlyph /></span>
            <div>
              <strong>{productText('选择知识库')}</strong>
              <p>{productText('回答前先从所选知识库检索相关片段，再由模型作答')}</p>
            </div>
          </header>
          {groups.length > 0 && (
            <div className={[
              'dsh-kb-picker-tabs-wrap',
              tabOverflow.scrollable ? 'is-scrollable' : '',
              tabOverflow.start ? 'is-overflow-start' : '',
              tabOverflow.end ? 'is-overflow-end' : '',
            ].filter(Boolean).join(' ')}>
              <nav ref={tabsRef} className="dsh-kb-picker-tabs" aria-label={productText('知识库类型')}>
                {groups.map((group) => {
                  const count = group.rows.filter(item => selected.has(item.id)).length
                  const active = group.key === currentGroup?.key
                  return (
                    <button
                      key={group.key}
                      type="button"
                      className={active ? 'is-active' : undefined}
                      aria-pressed={active}
                      onClick={(event) => {
                        setActiveGroup(group.key)
                        event.currentTarget.scrollIntoView?.({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
                      }}
                    >
                      {group.label}
                      {count > 0 && <span className="dsh-kb-picker-badge">{count}</span>}
                    </button>
                  )
                })}
              </nav>
            </div>
          )}
          <div className="dsh-kb-picker-tools">
            <label className="dsh-kb-picker-search">
              <SearchGlyph />
              <input
                value={query}
                placeholder={productText('搜索知识库')}
                aria-label={productText('搜索知识库')}
                onChange={(event) => { setQuery(event.target.value) }}
              />
            </label>
            {groupIds.length > 0 && (
              <button type="button" className="dsh-kb-picker-link" onClick={toggleGroup}>
                {groupAllSelected ? productText('取消全选') : productText('全选本类')}
              </button>
            )}
          </div>
          <div className="dsh-kb-picker-list" role="listbox" aria-multiselectable="true">
            {loading && catalog === null
              ? <p className="dsh-kb-picker-empty">{productText('正在加载…')}</p>
              : error !== '' && catalog === null
                ? (
                  <p className="dsh-kb-picker-empty is-error">
                    {error}
                    <button type="button" className="dsh-kb-picker-link" onClick={load}>{productText('重试')}</button>
                  </p>
                )
                : rows.length === 0
                  ? <p className="dsh-kb-picker-empty">{keyword === '' ? productText('暂无可用知识库') : productText('没有匹配的知识库')}</p>
                  : (
                    <>
                      {shownRows.map((item) => {
                        const checked = selected.has(item.id)
                        const disabled = !checked && selection.ids.length >= MAX_SELECTED
                        return (
                          <button
                            key={item.id}
                            type="button"
                            role="option"
                            aria-selected={checked}
                            disabled={disabled}
                            className={checked ? 'dsh-kb-picker-row is-checked' : 'dsh-kb-picker-row'}
                            onClick={() => { toggleItem(item.id) }}
                          >
                            <span className="dsh-kb-picker-check" aria-hidden="true"><CheckGlyph /></span>
                            <span className="dsh-kb-picker-row-body">
                              <strong>{item.name}</strong>
                              <small>{item.description === '' ? productText('暂无描述') : item.description}</small>
                            </span>
                          </button>
                        )
                      })}
                      {hasMore && (
                        <div className="dsh-kb-picker-more">
                          <small>{productText('已显示 {shown} / {total}')
                            .replace('{shown}', String(shownRows.length))
                            .replace('{total}', String(rows.length))}</small>
                          <button
                            ref={moreRef}
                            type="button"
                            className="dsh-kb-picker-more-btn"
                            onClick={() => { setVisibleCount(count => Math.min(rows.length, count + LIST_CHUNK)) }}
                          >
                            {productText('加载更多')}
                          </button>
                        </div>
                      )}
                    </>
                  )}
          </div>
          <footer className="dsh-kb-picker-foot">
            <span>
              {productText('已选 {count} 个').replace('{count}', String(selection.ids.length))}
              {selection.ids.length > 0 && (
                <button type="button" className="dsh-kb-picker-link"
                  onClick={() => { setSelection({ enabled: true, ids: [] }) }}>
                  {productText('清空')}
                </button>
              )}
            </span>
            <span className="dsh-kb-picker-actions">
              <button type="button" className="dsh-kb-picker-ghost"
                onClick={() => { setOpen(false); openLibrary() }}>
                {productText('管理知识库')}
              </button>
              <button type="button" className="dsh-kb-picker-done" onClick={() => { setOpen(false) }}>
                {productText('完成')}
              </button>
            </span>
          </footer>
        </div>,
        document.body,
      )}
    </div>
  )
}

function BookGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5A2.5 2.5 0 0 0 5 21.5v-17Z" />
      <path d="M5 19a2 2 0 0 1 2-2h12M9 7h6M9 11h6" />
    </svg>
  )
}

function ChevronGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4 10 4-4 4 4" />
    </svg>
  )
}

function SearchGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  )
}

function CheckGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  )
}
