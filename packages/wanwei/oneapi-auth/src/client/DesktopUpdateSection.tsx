/** Native updater controls; the browser never handles executable bytes. */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './AccountSection.module.css'

interface Snapshot {
  configured: boolean
  automatic: boolean
  currentVersion: string
  phase: string
  message: string
  received: number
  total: number
}
function nativeInvoke(): ((command: string, args: unknown) => Promise<unknown>) | undefined {
  return (window as Window & { __ZJUGIS_NATIVE_INVOKE__?: (command: string, args: unknown) => Promise<unknown> }).__ZJUGIS_NATIVE_INVOKE__
}
function snapshot(value: unknown): Snapshot {
  if (typeof value !== 'object' || value === null || !('configured' in value) || typeof value.configured !== 'boolean'
    || !('automatic' in value) || typeof value.automatic !== 'boolean' || !('currentVersion' in value) || typeof value.currentVersion !== 'string'
    || !('phase' in value) || typeof value.phase !== 'string' || !('message' in value) || typeof value.message !== 'string'
    || !('received' in value) || typeof value.received !== 'number' || !('total' in value) || typeof value.total !== 'number') throw new Error('Invalid native update status')
  return value as Snapshot
}

/** Version, persisted checking preference and explicit native update action.
 * @param props - Locale supplied by the owning settings section.
 * @returns Controls in the desktop shell; nothing in a standalone browser.
 */
export function DesktopUpdateSection({ t }: PropsLocale<'wanwei.auth'>) {
  const [view, setView] = useState<Snapshot>()
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)
  const mounted = useRef(true)
  const invoke = nativeInvoke()
  useEffect(() => {
    mounted.current = true
    if (invoke === undefined) return
    let disposed = false
    const refresh = async (): Promise<void> => {
      try {
        const next = snapshot(await invoke('desktop_update_status', {}))
        if (!disposed) setView(next)
      } catch (cause) { if (!disposed) setError(String(cause)) }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 1000)
    return () => { disposed = true; mounted.current = false; clearInterval(timer) }
  }, [invoke])
  if (invoke === undefined) return null
  const perform = async (command: string, args: unknown): Promise<void> => {
    setPending(true); setError(undefined)
    try {
      await invoke(command, args)
      const next = snapshot(await invoke('desktop_update_status', {}))
      if (mounted.current) setView(next)
    } catch (cause) { if (mounted.current) setError(String(cause)) }
    finally { if (mounted.current) setPending(false) }
  }
  const active = view !== undefined && ['checking', 'downloading', 'installing'].includes(view.phase)
  return <div className={css.models} aria-label={t('updatesTitle')}>
    <h2>{t('updatesTitle')}</h2>
    <p>{t('updatesVersion')} {view?.currentVersion ?? '—'}</p>
    <p className={css.hint}>{t('updatesHint')}</p>
    <label className={css.updateAutomatic}><input type="checkbox" checked={view?.automatic ?? false} disabled={pending || view === undefined}
      onChange={(event) => { void perform('desktop_update_automatic', { enabled: event.target.checked }) }} /> {t('updatesAutomatic')}</label>
    <p><button className={css.updateButton} type="button" disabled={pending || active || view?.configured !== true}
      onClick={() => { void perform('desktop_update_check', {}) }}>{pending || active ? t('updatesWorking') : t('updatesCheck')}</button></p>
    {view?.configured === false ? <p>{t('updatesUnavailable')}</p> : null}
    {view?.phase === 'downloading' ? <progress aria-label={t('updatesDownload')} value={view.received} max={view.total || 1} /> : null}
    {view?.message ? <p role="status">{view.message}</p> : null}
    {error === undefined ? null : <p role="alert" className={css.error}>{error}</p>}
  </div>
}
