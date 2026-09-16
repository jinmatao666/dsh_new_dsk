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
      <h2>{t('accountTitle')}</h2>
      {auth.state === 'authenticated'
        ? <>
          <div className={css.row}><span>{t('signedInAs')}</span><strong>{auth.username ?? '—'}</strong></div>
          <div className={css.models}><span>{t('models')}</span>{auth.models.length > 0 ? <ul>{auth.models.map(model => <li key={model}>{model}</li>)}</ul> : <p>{t('noModels')}</p>}</div>
          {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
          <button type="button" disabled={busy} onClick={() => { void signOut() }}>{busy ? t('signingOut') : t('signOut')}</button>
        </>
        : <p>{t('loginIntro')}</p>}
    </section>
  )
}
