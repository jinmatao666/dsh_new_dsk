/** Editor-owned top-layer panels; clipping ancestors never crop their contents. */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Anchor a keyboard-dismissable panel above a task-editor control.
 * @param props - Local panel state, accessible trigger and panel content.
 * @returns Trigger and viewport-clamped body portal.
 */
export function TaskPopover({ open, close, trigger, label, className = '', align = 'start', children }: {
  open: boolean
  close: () => void
  trigger: ReactNode
  label: string
  className?: string
  align?: 'start' | 'end'
  children: ReactNode
}) {
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      if (!anchor.current || !panel.current) return
      const rect = anchor.current.getBoundingClientRect()
      const width = panel.current.offsetWidth
      const height = panel.current.offsetHeight
      setPosition({
        left: Math.max(12, Math.min(align === 'end' ? rect.right - width : rect.left, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(rect.top - height - 8, window.innerHeight - height - 12)),
      })
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place)
    if (panel.current) observer?.observe(panel.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { observer?.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, align])
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !anchor.current?.contains(event.target)) close()
    }
    document.addEventListener('pointerdown', dismiss)
    return () => { document.removeEventListener('pointerdown', dismiss) }
  }, [open, close])
  return <span className="automation-popover-anchor" ref={anchor}>{trigger}{open && createPortal(
    <div ref={panel} className={`automation-editor-popover ${className}`} style={position} role="dialog" aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation(); close(); anchor.current?.querySelector('button')?.focus()
        }
      }}>{children}</div>, document.body,
  )}</span>
}
