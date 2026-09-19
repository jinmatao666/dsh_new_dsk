import { useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AuthState } from '../contract.ts'
import type { AuthView } from './controller.ts'
import css from './AccountSection.module.css'

export interface AccountInjected {
  hooks: { auth: HostObservable<AuthView> }
  logout: () => Promise<AuthState>
}

export type AccountSectionProps = PropsRuntime<'settings.section'>
  & InjectFace<AccountInjected>
  & PropsLocale<'wanwei.auth'>

/** Account status and logout page inside the standard settings shell. */
export function AccountSection({ useAuth, logout, t }: AccountSectionProps) {
  const auth = useAuth(view => view)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const signOut = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try { await logout() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }
  return (
    <section className={css.section}>
      <h1>{t('accountTitle')}</h1>
      <p className={css.hint}>{t('accountHint')}</p>
      <div className={css.card}>
        <div>
          <div className={css.label}>{t('signedInAs')}</div>
          <div className={css.value}>{auth.state === 'authenticated'
            ? (auth.username ?? t('signedInFallback'))
            : auth.state === 'offline'
              ? `${t('offlinePrefix')}${auth.message}`
              : auth.state === 'checking'
                ? t('checking')
                : t('loggedOut')}</div>
        </div>
        {auth.state === 'authenticated'
          ? <button className={css.logout} type="button" disabled={busy} onClick={() => { void signOut() }}>{busy ? t('signingOut') : t('signOut')}</button>
          : null}
      </div>
      {auth.state === 'authenticated' && auth.models.length > 0
        ? <div className={css.models}><span>{t('models')}</span><ul>{auth.models.map(model => <li key={model}>{model}</li>)}</ul></div>
        : null}
      {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
    </section>
  )
}
