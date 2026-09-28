import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import css from './Select.module.css'

export interface SelectOption {
  value: string
  label: string
}

/** A compact, rounded single-choice dropdown. The owner supplies localized labels. */
export function Select({ label, value, options, onChange, disabled = false, className, emptyLabel }: {
  label: string
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  className?: string | undefined
  emptyLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const selected = Math.max(0, options.findIndex(option => option.value === value))
  const selectedLabel = options.length === 0 ? emptyLabel ?? label : options.find(option => option.value === value)?.label ?? label

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const button = triggerRef.current
      const menu = listRef.current
      if (button === null || menu === null) return
      const trigger = button.getBoundingClientRect()
      const menuHeight = menu.offsetHeight
      const spaceBelow = window.innerHeight - trigger.bottom
      const above = spaceBelow < menuHeight + 12 && trigger.top > spaceBelow
      setPosition({
        left: Math.max(8, Math.min(trigger.left, window.innerWidth - trigger.width - 8)),
        top: above ? Math.max(8, trigger.top - menuHeight - 4) : trigger.bottom + 4,
        width: trigger.width,
        maxWidth: Math.max(0, window.innerWidth - 16),
        fontSize: window.getComputedStyle(button).fontSize,
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => { document.removeEventListener('pointerdown', dismiss) }
  }, [open])

  const choose = (index: number) => {
    const option = options[index]
    if (option === undefined) return
    onChange(option.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  return <>
    <button ref={triggerRef} type="button" role="combobox" aria-label={label}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={open ? `${listId}-${active}` : undefined}
      disabled={disabled || options.length === 0}
      className={[css.trigger, className].filter(Boolean).join(' ')}
      onBlur={() => { setOpen(false) }}
      onClick={() => { setActive(selected); setOpen(current => !current) }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { setOpen(false); return }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          setActive(current => open
            ? (current + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length
            : selected)
          setOpen(true)
        } else if (event.key === 'Home' && open) {
          event.preventDefault(); setActive(0)
        } else if (event.key === 'End' && open) {
          event.preventDefault(); setActive(options.length - 1)
        } else if ((event.key === 'Enter' || event.key === ' ') && open) {
          event.preventDefault(); choose(active)
        }
      }}>
      <span className={css.value}>{selectedLabel}</span>
      <svg className={css.chevron} viewBox="0 0 16 16" aria-hidden="true">
        <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
    {open && createPortal(<div ref={listRef} id={listId} className={css.list}
      role="listbox" aria-label={label} style={position}>
      {options.map((option, index) => <div key={option.value} id={`${listId}-${index}`}
        role="option" aria-selected={option.value === value}
        className={`${css.option}${index === active ? ` ${css.active}` : ''}`}
        onPointerEnter={() => { setActive(index) }}
        onPointerDown={(event) => { event.preventDefault() }}
        onClick={() => { choose(index) }}>{option.label}</div>)}
    </div>, document.body)}
  </>
}
