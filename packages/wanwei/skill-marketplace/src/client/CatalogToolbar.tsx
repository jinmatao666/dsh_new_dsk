import { productText } from './locales/product.ts'

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
  return <form className="dsh-skill-catalog-toolbar" onSubmit={(event) => { event.preventDefault(); onSearch() }}>
    <div className="dsh-skill-search-row"><input aria-label={searchLabel} placeholder={searchLabel} value={keyword}
      maxLength={200} onChange={(event) => { onKeyword(event.target.value) }} /></div>
    <select aria-label={`${searchLabel} / ${categoryLabel}`} value={category}
      onChange={(event) => { onCategory(event.target.value) }}>
      <option value="">{categoryLabel}</option>
      {categories.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
    </select>
    {onSort && <select aria-label={`${searchLabel} / ${productText('热门下载')}`} value={sort}
      onChange={(event) => { onSort(event.target.value) }}>
      <option value="downloads">{productText('热门下载')}</option>
      <option value="updated_at">{productText('最近更新')}</option>
    </select>}
    <div className="dsh-skill-catalog-pagination">
      <button type="button" disabled={loading || page <= 1} onClick={() => { onPage(page - 1) }}>{productText('上一页')}</button>
      <span aria-live="polite">{productText('第')}{page}{productText(' 页')} / {pages}</span>
      <button type="button" disabled={loading || page >= pages} onClick={() => { onPage(page + 1) }}>{productText('下一页')}</button>
    </div>
  </form>
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
