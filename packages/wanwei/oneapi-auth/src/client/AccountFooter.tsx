import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountInjected } from './AccountSection.tsx'
import { CheckinShortcut, type CreditsInjected } from './CreditsSection.tsx'
import css from './AccountFooter.module.css'

type FooterProps = PropsRuntime<'sidebar.footer'> & PropsLocale<'wanwei.auth'>
  & InjectFace<CreditsInjected & Pick<AccountInjected, 'logout'>>

/** Display the account and reveal the existing sidebar controls on demand. */
export function AccountFooter({ controls, wide, useAuth, requestCredits, logout, t, billing, accounting }: FooterProps) {
  const creditsEnabled = useSyncExternalStore(billing?.subscribe ?? (() => () => {}), billing?.getSnapshot ?? (() => true))
  const accountingEnabled = useSyncExternalStore(accounting?.subscribe ?? (() => () => {}), accounting?.getSnapshot ?? (() => true))
  const auth = useAuth(value => value)
  const username = auth.state === 'authenticated' ? auth.username?.trim() : undefined
  const label = username || t('accountNav')
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutFailed, setSignOutFailed] = useState(false)
  const signOut = async () => {
    setSigningOut(true)
    setSignOutFailed(false)
    try {
      await logout()
      setOpen(false)
      setCredit(undefined)
    } catch {
      setSignOutFailed(true)
    } finally {
      setSigningOut(false)
    }
  }
  const [credit, setCredit] = useState<{ auth: typeof auth; value: string }>()
  useEffect(() => {
    if (!creditsEnabled || !open || auth.state !== 'authenticated') return
    let live = true, revision = 0
    const refresh = () => {
      const current = ++revision
      setCredit(undefined)
      void requestCredits('history').then((result) => {
        if (!live || current !== revision) return
        const amount = (result as { balance?: unknown } | null)?.balance
        setCredit({ auth, value: typeof amount === 'number' && Number.isFinite(amount)
          ? amount.toLocaleString(undefined, { maximumFractionDigits: 4 }) : t('accountCreditsUnavailable') })
      }).catch(() => {
        if (live && current === revision) setCredit({ auth, value: t('accountCreditsUnavailable') })
      })
    }
    refresh()
    window.addEventListener('wanwei:credits-changed', refresh)
    return () => { live = false; window.removeEventListener('wanwei:credits-changed', refresh) }
  }, [auth, open, requestCredits, t, creditsEnabled])
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (document.activeElement?.closest('[role="dialog"], dialog[open]')) return
      if (document.activeElement !== null && root.current?.contains(document.activeElement)) {
        event.preventDefault()
        trigger.current?.focus()
      }
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return <div ref={root} className={css.root} data-wide={wide}>
    <div className={css.row}>
      <button ref={trigger} type="button" className={css.trigger} title={label} aria-label={label}
        aria-expanded={open} aria-controls={panelId} onClick={() => { setCredit(undefined)
          setSignOutFailed(false); setOpen(value => !value) }}>
        <span className={css.avatar} aria-hidden="true"><img src="/brand-mark.svg" width={25} height={22} alt="" /></span>
        {wide && <><span className={css.name}>{label}</span>
          <svg className={css.chevron} viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="m4 7 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg></>}
      </button>
      {wide && creditsEnabled && accountingEnabled && <CheckinShortcut wide={wide} useAuth={useAuth}
        requestCredits={requestCredits} onOpen={() => { setOpen(false) }} />}
    </div>
    <div id={panelId} className={css.panel} hidden={!open}>
      {creditsEnabled && auth.state === 'authenticated' && <div className={css.credits}>
        <img src="/brand-mark.svg" className={css.creditMark} width={82} height={72} alt="" />
        <span className={css.creditLabel}>{t('accountCreditsBalance')}</span>
        <strong className={css.creditValue} aria-live="polite">{credit?.auth === auth ? credit.value : '—'}</strong>
      </div>}
      {controls}
      {auth.state === 'authenticated' && <div className={css.signOutArea}>
        <button className={css.signOut} type="button" disabled={signingOut} onClick={() => { void signOut() }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M7 2.5H4A1.5 1.5 0 0 0 2.5 4v8A1.5 1.5 0 0 0 4 13.5h3M7 8h6.5m-2.75-2.75L13.5 8l-2.75 2.75" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {signingOut ? t('signingOut') : t('signOut')}
        </button>
        {signOutFailed && <div className={css.signOutError} role="alert">{t('signOutFailed')}</div>}
      </div>}
    </div>
  </div>
}
