import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import css from './AuthGate.module.css'

/** Native top-layer dialog remains above the blocking login surface. */
export function LoginDialog({ open, title, closeLabel, onClose, children, compact = false }: {
  compact?: boolean
  open: boolean
  title: string
  closeLabel: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (open && ref.current && !ref.current.open) ref.current.showModal()
  }, [open])
  if (!open) return null
  return <dialog ref={ref} className={css.loginDialog} data-compact={compact || undefined} aria-label={title}
    onCancel={onClose} onClose={onClose}>
    <header><h2>{title}</h2><button className={css.loginDialogClose} type="button" aria-label={closeLabel} onClick={onClose}><IconCloseOutline16 size={18} /></button></header>
    {children}
  </dialog>
}
