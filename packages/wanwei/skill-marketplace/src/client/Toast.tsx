import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import css from './Toast.module.css'

export interface WanweiNotice {
  kind: 'success' | 'error' | 'info'
  text: string
}

/** Product-owned transient feedback, outside the marketplace scroll area. */
export function Toast({ notice, setNotice }: {
  notice: WanweiNotice | null
  setNotice: Dispatch<SetStateAction<WanweiNotice | null>>
}) {
  useEffect(() => {
    if (notice === null) return undefined
    const timer = window.setTimeout(() => {
      setNotice(current => current === notice ? null : current)
    }, notice.kind === 'error' ? 7_000 : 4_500)
    return () => { window.clearTimeout(timer) }
  }, [notice, setNotice])

  if (notice === null) return null
  return (
    <div className={css.toast} data-kind={notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <span className={css.icon} aria-hidden="true">{notice.kind === 'error' ? '!' : '✓'}</span>
      <span className={css.message}>{notice.text}</span>
      <button
        className={css.close}
        type="button"
        aria-label="关闭提示"
        onClick={() => { setNotice(current => current === notice ? null : current) }}
      >×</button>
    </div>
  )
}
