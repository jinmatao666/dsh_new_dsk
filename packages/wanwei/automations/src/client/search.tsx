/** Inline search shared by task cards and the run ledger. */
import { useRef, useState } from 'react'
import { productText as text } from './locales/product.ts'

/** Expand in place, retaining nonempty filters until explicitly cleared.
 * @param props - Accessible label and controlled query.
 * @returns A search button or its focused input.
 */
export function AutomationSearch({ label, query, change }: {
  label: string
  query: string
  change: (value: string) => void
}) {
  const [open, setOpen] = useState(() => Boolean(query))
  const button = useRef<HTMLButtonElement>(null)
  const icon = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="7" /><path d="m16 16 5 5" /></svg>
  return <div className={`automation-inline-search${open ? ' expanded' : ''}`}>
    <button ref={button} type="button" className="automation-search-toggle" aria-label={label}
      title={text('搜索定时任务/记录')} aria-expanded={open} hidden={open}
      onClick={() => { setOpen(true) }}>{icon}</button>
    {open && <label>{icon}<input autoFocus aria-label={label} placeholder={text('搜索定时任务/记录')}
      value={query} onChange={(event) => { change(event.target.value) }}
      onBlur={() => { if (!query.trim()) setOpen(false) }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation(); change(''); setOpen(false)
        requestAnimationFrame(() => { button.current?.focus() })
      }} /></label>}
  </div>
}
