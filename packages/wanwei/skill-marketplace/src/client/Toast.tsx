import { productText } from './locales/product.ts'
import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import css from './Toast.module.css'

export interface WanweiNotice {
  kind: 'success' | 'error' | 'info'
  text: string
  /** Keep operation progress visible until a result replaces it. */
  pending?: boolean
}

/** Keep notice interactions from being treated as clicks outside the marketplace. */
export function isNoticeTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-wanwei-notice]') !== null
}

/** Product-owned transient feedback, outside the marketplace scroll area. */
export function Toast({ notice, setNotice }: {
  notice: WanweiNotice | null
  setNotice: Dispatch<SetStateAction<WanweiNotice | null>>
}) {
  useEffect(() => {
    if (notice === null || notice.pending) return undefined
    const timer = window.setTimeout(() => {
      setNotice(current => current === notice ? null : current)
    }, notice.kind === 'error' ? 7_000 : 4_500)
    return () => { window.clearTimeout(timer) }
  }, [notice, setNotice])

  if (notice === null) return null
  return (
    <div className={css.toast} data-wanwei-notice data-kind={notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <svg className={css.icon} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        {notice.kind === 'success' ? <path d="m8 12 3 3 5-6" /> : <><path d="M12 8v5" /><circle cx="12" cy="16" r=".6" fill="currentColor" stroke="none" /></>}
      </svg>
      <span className={css.message}>{notice.text}</span>
      <button
        className={css.close}
        type="button"
        aria-label={productText('关闭提示')}
        onClick={() => { setNotice(current => current === notice ? null : current) }}
      >×</button>
    </div>
  )
}
