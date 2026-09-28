import { productText } from './locales/product.ts'
import { useLayoutEffect, useRef, useState } from 'react'
import { Select } from '@deepseek-ai/dsh-client-ui-primitives'

function visiblePages(page: number, pages: number): (number | 'gap')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1)
  const nearby = new Set([1, pages, page - 1, page, page + 1])
  const numbers = [...nearby].filter(value => value >= 1 && value <= pages).sort((a, b) => a - b)
  const result: (number | 'gap')[] = []
  numbers.forEach((value, index) => {
    if (index > 0 && value - (numbers[index - 1] ?? value) > 1) result.push('gap')
    result.push(value)
  })
  return result
}

/** Search, filters and pagination belong to one catalog, not the surrounding page. */
export function CatalogToolbar({
  searchLabel, keyword, onKeyword, onSearch, categories, category, onCategory, sort, onSort, page, pages, loading = false, onPage,
  categoryLabel = productText('全部分类'),
}: {
  searchLabel: string
  keyword: string
  onKeyword: (value: string) => void
  onSearch: () => void
  categories: readonly { key: string; name: string }[]
  category: string
  onCategory: (value: string) => void
  sort?: string
  onSort?: (value: string) => void
  categoryLabel?: string
  page: number
  pages: number
  loading?: boolean
  onPage: (value: number) => void
}) {
  const [jump, setJump] = useState('')
  const toolbarRef = useRef<HTMLDivElement>(null)
  const pendingScroll = useRef<{ panel: HTMLElement; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!pendingScroll.current) return
    pendingScroll.current.panel.scrollTop = pendingScroll.current.top
    pendingScroll.current = null
  })
  const preservePosition = (action: () => void) => {
    const panel = toolbarRef.current?.closest<HTMLElement>('.dsh-skill-market-panel')
    const saved = panel ? { panel, top: panel.scrollTop } : null
    pendingScroll.current = saved
    action()
    queueMicrotask(() => { if (pendingScroll.current === saved) pendingScroll.current = null })
  }
  return <div ref={toolbarRef} className="dsh-skill-catalog-toolbar">
    <form className="dsh-skill-search-row" onSubmit={(event) => { event.preventDefault(); preservePosition(onSearch) }}>
      <input aria-label={searchLabel} placeholder={searchLabel} value={keyword}
        maxLength={200} onChange={(event) => { onKeyword(event.target.value) }} />
    </form>
    <Select label={`${searchLabel} / ${categoryLabel}`} value={category}
      options={[{ value: '', label: categoryLabel }, ...categories.map(item => ({ value: item.key, label: item.name }))]}
      onChange={(value) => { preservePosition(() => { onCategory(value) }) }} />
    {onSort && <Select label={`${searchLabel} / ${productText('热门下载')}`} value={sort ?? 'downloads'}
      options={[{ value: 'downloads', label: productText('热门下载') }, { value: 'updated_at', label: productText('最近更新') }]}
      onChange={(value) => { preservePosition(() => { onSort(value) }) }} />}
    <div className="dsh-skill-catalog-pagination">
      <button type="button" disabled={loading || page <= 1} onClick={() => { preservePosition(() => { onPage(page - 1) }) }}>{productText('上一页')}</button>
      <span className="dsh-skill-page-count" aria-live="polite">{productText('第')}{page}{productText(' 页')} / {pages}</span>
      <span className="dsh-skill-page-choices" aria-label={productText('选择页码')}>
        {visiblePages(page, pages).map((value, index) => value === 'gap'
          ? <span className="dsh-skill-page-gap" key={`gap-${index}`} aria-hidden="true">…</span>
          : <button className="dsh-skill-page-number" type="button" key={value}
            aria-label={`${productText('第')}${value}${productText(' 页')}`}
            aria-current={value === page ? 'page' : undefined}
            disabled={loading || value === page} onClick={() => { preservePosition(() => { onPage(value) }) }}>{value}</button>)}
      </span>
      <button type="button" disabled={loading || page >= pages} onClick={() => { preservePosition(() => { onPage(page + 1) }) }}>{productText('下一页')}</button>
      <form className="dsh-skill-page-jump" onSubmit={(event) => {
        event.preventDefault()
        const target = Number(jump)
        if (!loading && /^[1-9]\d*$/.test(jump) && Number.isSafeInteger(target) && target <= pages) {
          preservePosition(() => { onPage(target) })
          setJump('')
        }
      }}>
        <input type="text" inputMode="numeric" aria-label={productText('跳转页码')}
          placeholder={productText('页码')} value={jump} onChange={(event) => { setJump(event.target.value) }} />
        <button type="submit" disabled={loading || jump === ''}>{productText('跳转')}</button>
      </form>
    </div>
  </div>
}

/** Shared card download-count glyph for both catalog sources. */
export function CatalogDownloadIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" />
  </svg>
}

/** Shared return glyph for platform and SkillHub detail navigation. */
export function CatalogBackIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
  </svg>
}
