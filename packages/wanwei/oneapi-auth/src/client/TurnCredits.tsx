import { useEffect, useState, useSyncExternalStore } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { Modal, IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CreditsInjected } from './CreditsSection.tsx'
import { accountIcons } from './account-icons.ts'
import css from './TurnCredits.module.css'

export interface TurnCreditSummary {
  enabled: boolean
  credits: number
  pending: boolean
  items: { id: string; name: string; credits: number }[]
}

export interface TurnCreditsInjected {
  accounting: HostObservable<boolean>
  requestTurnCredits(sessionId: string, turnId: number): Promise<TurnCreditSummary>
}

type TurnCreditsProps = PropsRuntime<'conversation.chat.turnUsage'> & PropsLocale<'wanwei.auth'>
  & InjectFace<Pick<CreditsInjected, 'hooks'> & TurnCreditsInjected>

const points = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 6 })

/** Show server-settled charges for one exact turn; deployment policy owns visibility. */
export function TurnCredits({ turn, sessionId, accounting, requestTurnCredits, useAuth, t }: TurnCreditsProps) {
  const enabled = useSyncExternalStore(accounting.subscribe, accounting.getSnapshot)
  const auth = useAuth(state => state)
  const routes = turn.data.get('turn-tail')?.tokenUsage?.routes
  const customModelOnly = routes !== undefined && routes.length > 0 && routes.every(route => route.provider !== 'dsh-server')
  const [summary, setSummary] = useState<TurnCreditSummary>()
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setSummary(undefined); setError(false)
    if (!enabled || auth.state !== 'authenticated' || turn.end === undefined) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const refresh = async () => {
      try {
        const next = await requestTurnCredits(String(sessionId), turn.turn)
        if (!live) return
        setSummary(next); setError(false)
        if (next.enabled && (next.pending || next.items.length === 0) && ++attempts < 5) {
          timer = setTimeout(() => { void refresh() }, 2000)
        }
      } catch {
        if (live) setError(true)
      }
    }
    timer = setTimeout(() => { void refresh() }, 500)
    return () => { live = false; clearTimeout(timer) }
  }, [enabled, auth, sessionId, turn.turn, turn.end, requestTurnCredits])
  useEffect(() => { if (!enabled || auth.state !== 'authenticated') setOpen(false) }, [enabled, auth])
  if (!enabled || auth.state !== 'authenticated' || turn.end === undefined || summary?.enabled === false) return null
  if (customModelOnly && !error && summary !== undefined && !summary.pending && summary.items.length === 0) {
    return <span className={css.staticLabel}>
      <span className={css.icon} style={{ maskImage: `url("${accountIcons.coins}")` }} aria-hidden="true" />
      <span>{t('turnCreditsNone')}</span>
    </span>
  }
  const label = error ? t('turnCreditsFailed') : summary === undefined || summary.pending
    ? t('turnCreditsPending') : summary.items.length === 0 ? t('turnCreditsMissing')
      : `${points(summary.credits)} ${t('turnCreditsUnit')}`
  return <>
    <button className={css.trigger} type="button" onClick={() => { setOpen(true) }}>
      <span className={css.icon} style={{ maskImage: `url("${accountIcons.coins}")` }} aria-hidden="true" />
      <span>{t('turnCreditsLabel')}</span>
      <span className={css.separator}>·</span><span className={css.value}>{label}</span>
      <span className={css.chevron} aria-hidden>›</span>
    </button>
    <Modal open={open} headless title={t('turnCreditsDetails')} className={css.modal ?? ''} onClose={() => { setOpen(false) }}>
      <div className={css.header}>
        <h2>{t('turnCreditsDetails')}</h2>
        <button className={css.close} type="button" aria-label={t('turnCreditsClose')} onClick={() => { setOpen(false) }}>
          <IconCloseOutline16 size={14} />
        </button>
      </div>
      <div className={css.dialog}>
        {summary !== undefined && summary.items.length > 0 ? <>
          <div className={css.total}><span>{t('turnCreditsActual')}</span><strong>{points(summary.credits)} <small>{t('turnCreditsUnit')}</small></strong></div>
          <div className={css.items}>{summary.items.map(item => <div className={css.item} key={item.id}>
            <span>{item.name}</span><span>{points(Math.abs(item.credits))}</span>
          </div>)}</div>
          <p className={css.note}>{t('turnCreditsHistoryBefore')}<button type="button" className={css.historyLink}
            onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent('dsh:open-settings-section', { detail: 'wanwei-credits' })) }}>
            {t('turnCreditsHistoryLink')}</button>{t('turnCreditsHistoryAfter')}</p>
        </> : <p className={css.note}>{label}</p>}
      </div>
    </Modal>
  </>
}
