/** Independent browser assistant card for the shared plugin configuration slot. */
import { useId, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from './locales.ts'
import css from './BrowserCard.module.css'

/** Persisted browser tool permission. */
export interface BrowserPreference { enabled: boolean }
/** Services bound to the card by its plugin. */
export interface BrowserCardFace {
  hooks: {
    preference: HostObservable<SettingsScopeSnapshot<BrowserPreference>>
    network: HostObservable<{ mode: 'internet' | 'intranet' }>
    administratorAllowed: HostObservable<boolean>
  }
  setEnabled(enabled: boolean): Promise<void>
}
/** Renderer-owned props and plugin-owned services. */
export type BrowserCardProps = PropsRuntime<'settings.plugin.item'> & PropsLocale<'wanwei.browser'> & InjectFace<BrowserCardFace>
/** Render a durable permission switch without claiming browser connection status.
 * @param props - settings mirror, network policy and writer.
 * @returns the settings card.
 */
export function BrowserCard(props: BrowserCardProps) {
  const snapshot = props.usePreference(value => value)
  const intranet = props.useNetwork(value => value.mode) === 'intranet'
  const administratorAllowed = props.useAdministratorAllowed(value => value)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const enabled = snapshot.value?.enabled === true
  const blocked = !administratorAllowed || intranet || snapshot.status !== 'ready' || !snapshot.writable || saving
  const toggle = async () => {
    setSaving(true)
    setFailed(false)
    try { await props.setEnabled(!enabled) }
    catch { setFailed(true) } // SettingsScope recovers the Host snapshot after a rejected write.
    finally { setSaving(false) }
  }
  const status = !administratorAllowed ? 'administratorDisabled' : intranet ? 'intranet' : saving ? 'saving'
    : snapshot.status !== 'ready' || !snapshot.writable ? 'unavailable' : enabled ? 'enabled' : 'disabled'
  return <li className={`${css.card} ${open ? css.cardOpen : ''}`}>
    <button type="button" className={css.header} aria-expanded={open} aria-controls={open ? bodyId : undefined}
      aria-label={props.t(open ? 'collapse' : 'expand')} onClick={() => { setOpen(value => !value) }}>
      <span className={css.copy}><span className={css.title}>{props.t('title')}</span><span className={css.description}>{props.t('description')}</span></span>
      <svg className={`${css.chevron} ${open ? css.chevronOpen : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {open && <div className={css.body} id={bodyId}>
      <div className={css.row}>
        <span>{props.t('permission')}</span>
        <div className={css.control}>
          <span>{props.t(status)}</span>
          <button type="button" role="switch" aria-label={props.t('title')}
            aria-checked={enabled && !intranet && administratorAllowed} disabled={blocked}
            className={`${css.switch} ${enabled && !intranet && administratorAllowed ? css.on : ''}`}
            onClick={() => { void toggle() }}><span className={css.thumb} /></button>
        </div>
      </div>
      <p className={css.hint}>{props.t('timing')}</p>
      {failed && <p className={css.error} role="alert">{props.t('failed')}</p>}
    </div>}
  </li>
}
