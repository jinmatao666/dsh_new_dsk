import {
  useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import {
  getActiveConnectorIds,
  subscribeActiveConnector,
  toggleActiveConnectorId,
} from './active-connector.ts'
import { productText } from './locales/product.ts'

/** One switchable entry shown in the composer connector picker. */
export type ComposerConnectorOption = {
  id: string
  name: string
  icon: string
  accent: string
  /** False when the connector cannot be selected until the user connects it. */
  available: boolean
}

/**
 * Active-connector chips beside `+`. Opens a WorkBuddy-style catalog popover
 * (selected rows first, scrollable list + manage footer) portaled above the composer.
 * @param props.options - Full connector catalog for the picker.
 * @param props.onManage - Open the connectors feature panel.
 */
export function ComposerConnectorChip({
  options,
  onManage,
}: {
  options: readonly ComposerConnectorOption[]
  onManage: () => void
}) {
  const activeIds = useSyncExternalStore(subscribeActiveConnector, getActiveConnectorIds, getActiveConnectorIds)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})

  const activeOptions = useMemo(
    () => options.filter(option => activeIds.includes(option.id)),
    [options, activeIds],
  )
  const orderedOptions = useMemo(() => {
    const selected: ComposerConnectorOption[] = []
    const connected: ComposerConnectorOption[] = []
    const rest: ComposerConnectorOption[] = []
    for (const option of options) {
      if (activeIds.includes(option.id)) selected.push(option)
      else if (option.available) connected.push(option)
      else rest.push(option)
    }
    // WorkBuddy order: switch-on first, then other connected accounts, then connect CTAs.
    return [...selected, ...connected, ...rest]
  }, [options, activeIds])

  useLayoutEffect(() => {
    if (!open || triggerRef.current === null) return
    const place = () => {
      const rect = triggerRef.current!.getBoundingClientRect()
      const width = 280
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
      setMenuStyle({
        position: 'fixed',
        left,
        bottom: window.innerHeight - rect.top + 8,
        width,
        zIndex: 40,
      })
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
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (activeOptions.length === 0) return null

  const labelNames = activeOptions.map(option => option.name).join('、')

  return (
    <div className="dsh-composer-connector">
      <button
        ref={triggerRef}
        type="button"
        className="dsh-composer-connector-trigger"
        aria-label={productText('当前连接器：{0}', [labelNames])}
        aria-haspopup="menu"
        aria-expanded={open}
        title={labelNames}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className="dsh-composer-connector-stack">
          {activeOptions.map(option => (
            <span key={option.id} className="dsh-composer-connector-stack-item">
              <ConnectorGlyph icon={option.icon} size={16} />
            </span>
          ))}
        </span>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="dsh-composer-connector-menu"
          role="menu"
          aria-label={productText('切换连接器')}
          style={menuStyle}
        >
          <div className="dsh-composer-connector-menu-list">
            {orderedOptions.map(option => {
              const selected = activeIds.includes(option.id)
              return (
                <div
                  key={option.id}
                  className={selected ? 'dsh-composer-connector-row is-active' : 'dsh-composer-connector-row'}
                  role="menuitem"
                >
                  <span className="dsh-composer-connector-row-icon">
                    <ConnectorGlyph icon={option.icon} size={18} />
                  </span>
                  <span className="dsh-composer-connector-row-name">{option.name}</span>
                  {option.available ? (
                    <button
                      type="button"
                      className={selected ? 'dsh-composer-connector-switch is-on' : 'dsh-composer-connector-switch'}
                      role="switch"
                      aria-checked={selected}
                      aria-label={option.name}
                      onClick={() => {
                        toggleActiveConnectorId(option.id)
                      }}
                    >
                      <span />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="dsh-composer-connector-connect"
                      onClick={() => {
                        setOpen(false)
                        onManage()
                      }}
                    >
                      <ConnectLinkIcon />
                      {productText('连接')}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <button
            type="button"
            role="menuitem"
            className="dsh-composer-connector-manage"
            onClick={() => {
              setOpen(false)
              onManage()
            }}
          >
            <ManageLinkIcon />
            {productText('管理连接器')}
          </button>
        </div>,
        document.body,
      )}
    </div>
  )
}

function ConnectorGlyph({ icon, size = 14 }: { icon: string; size?: number }) {
  if (icon.startsWith('/')) {
    return <img src={icon} alt="" width={size} height={size} />
  }
  return <span aria-hidden="true">{icon}</span>
}

function ConnectLinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6.4 9.6a2.8 2.8 0 0 1 0-4L8.2 3.8a2.8 2.8 0 1 1 4 4L10.8 9.2" strokeLinecap="round" />
      <path d="M9.6 6.4a2.8 2.8 0 0 1 0 4L7.8 12.2a2.8 2.8 0 1 1-4-4L5.2 6.8" strokeLinecap="round" />
    </svg>
  )
}

function ManageLinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6.5 3.5H4.2A1.7 1.7 0 0 0 2.5 5.2v6.6A1.7 1.7 0 0 0 4.2 13.5h6.6a1.7 1.7 0 0 0 1.7-1.7V9.5" strokeLinecap="round" />
      <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
