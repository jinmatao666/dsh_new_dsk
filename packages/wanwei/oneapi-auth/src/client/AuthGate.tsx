import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AuthState } from '../contract.ts'
import type { AuthView } from './controller.ts'
import css from './AuthGate.module.css'

export interface AuthInjected {
  hooks: { auth: HostObservable<AuthView> }
  refresh: (signal?: AbortSignal) => Promise<AuthState>
  login: (username: string, password: string, signal?: AbortSignal) => Promise<AuthState>
  fail: (error: unknown) => void
}

export type AuthGateProps = PropsRuntime<'shell.overlay'>
  & InjectFace<AuthInjected>
  & PropsLocale<'wanwei.auth'>

type LoginMode = 'account' | 'sms' | 'qr'

/** Blocking desktop login surface; credentials are sent only to the local Host. */
export function AuthGate({ useAuth, refresh, login, fail, t }: AuthGateProps) {
  const auth = useAuth(view => view)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [loginMode, setLoginMode] = useState<LoginMode>('account')
  const pageRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if ('username' in auth) setUsername(auth.username)
  }, [auth])

  useEffect(() => {
    const controllers = new Set<AbortController>()
    let refreshing = false
    const run = (): void => {
      if (refreshing) return
      refreshing = true
      const controller = new AbortController()
      controllers.add(controller)
      void refresh(controller.signal).catch(fail).finally(() => {
        controllers.delete(controller)
        refreshing = false
      })
    }
    const onVisibility = (): void => { if (document.visibilityState === 'visible') run() }
    run()
    window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', onVisibility)
    const timer = window.setInterval(run, 300_000)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', run)
      document.removeEventListener('visibilitychange', onVisibility)
      for (const controller of controllers) controller.abort()
    }
  }, [fail, refresh])

  useLayoutEffect(() => {
    const page = pageRef.current
    if (page === null) return
    const update = (): void => {
      if (!window.matchMedia('(min-width: 961px)').matches) {
        page.style.removeProperty('--login-scale')
        page.style.removeProperty('--login-layout-width')
        page.style.removeProperty('--login-layout-height')
        return
      }
      const scale = Math.max(0.82, Math.min(window.innerWidth / 1120, window.innerHeight / 720, 1.4))
      page.style.setProperty('--login-scale', scale.toFixed(4))
      page.style.setProperty('--login-layout-width', `${window.innerWidth / scale}px`)
      page.style.setProperty('--login-layout-height', `${window.innerHeight / scale}px`)
    }
    update()
    window.addEventListener('resize', update)
    return () => { window.removeEventListener('resize', update) }
  }, [])

  if (auth.state === 'authenticated') return null

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await login(username, password)
      setPassword('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const retry = (): void => { setError(undefined); void refresh().catch(fail) }
  const serviceError = error ?? (auth.state === 'offline' ? auth.message || t('offline') : undefined)
  const changeMode = (mode: LoginMode): void => { setLoginMode(mode); setError(undefined) }

  return (
    <div className={css.backdrop}>
      <div className={css.decoBlobOne} aria-hidden="true" />
      <div className={css.decoBlobTwo} aria-hidden="true" />
      <div className={css.decoBlobThree} aria-hidden="true" />
      <main ref={pageRef} className={css.page} aria-label={t('pageLabel')}>
        <section className={css.brandSide} aria-label={t('productIntroLabel')}>
          <div className={css.brandHeader} aria-label={t('productName')}>
            <span className={css.brandSymbol} aria-hidden="true"><span>{t('brandMark')}</span></span>
            <strong>{t('productName')}</strong>
            <span className={css.previewBadge}>{t('previewBadge')}</span>
          </div>
          <div className={css.brandHero}>
            <h1>{t('heroTitle')}<br /><span>{t('heroHighlight')}</span></h1>
            <p>{t('heroDescription')}</p>
          </div>
          <div className={css.featureList} aria-label={t('coreCapabilities')}>
            <Feature icon={<FileIcon />} label={t('localFiles')} />
            <Feature icon={<SearchIcon />} label={t('knowledgeQa')} />
            <Feature icon={<FlowIcon />} label={t('taskCollaboration')} />
            <Feature icon={<ServerIcon />} label={t('flexibleDeployment')} />
          </div>
          <div className={css.capabilityCard}>
            <h2><span className={css.sectionDot} />{t('agentCapabilities')}</h2>
            <div className={css.capabilityGrid}>
              <Capability icon={<SearchIcon />} title={t('knowledgeQa')} detail={t('knowledgeQaDetail')} />
              <Capability icon={<FileIcon />} title={t('documentProcessing')} detail={t('documentProcessingDetail')} />
              <Capability icon={<FlowIcon />} title={t('taskWorkflow')} detail={t('taskWorkflowDetail')} />
              <Capability icon={<ServerIcon />} title={t('controlledDeployment')} detail={t('controlledDeploymentDetail')} />
            </div>
          </div>
          <p className={css.pageFooter}>{t('copyright')}</p>
        </section>

        <section className={css.formSide} aria-label={t('loginTitle')}>
          <div className={css.card}>
            <div className={css.cardHeader}><h2>{t('loginTitle')}</h2><p>{t('loginIntro')}</p></div>
            <div className={css.loginMode} role="tablist" aria-label={t('loginMethods')}>
              {(['account', 'sms', 'qr'] as const).map(mode => (
                <button key={mode} type="button" className={loginMode === mode ? css.loginModeActive : undefined} role="tab" aria-selected={loginMode === mode} onClick={() => { changeMode(mode) }}>
                  {t(mode === 'account' ? 'accountLogin' : mode === 'sms' ? 'smsLogin' : 'qrLogin')}
                </button>
              ))}
            </div>
            {auth.state === 'checking'
              ? <p className={css.status}>{t('checking')}</p>
              : loginMode === 'account'
                ? (
                  <form onSubmit={(event) => { void submit(event) }}>
                    <label>{t('username')}<input autoFocus autoComplete="username" value={username} onChange={(event) => { setUsername(event.target.value) }} placeholder={t('usernamePlaceholder')} required /></label>
                    <label>{t('password')}<input type="password" autoComplete="current-password" value={password} onChange={(event) => { setPassword(event.target.value) }} placeholder={t('passwordPlaceholder')} required /></label>
                    <div className={css.formOptions}>
                      <label className={css.remember}><input type="checkbox" /> <span>{t('rememberMe')}</span></label>
                      <button className={css.textAction} type="button" disabled>{t('forgotPassword')}</button>
                    </div>
                    {serviceError !== undefined ? <p className={css.error} role="alert">{serviceError}</p> : null}
                    <button className={css.primaryButton} type="submit" disabled={busy || username.trim() === '' || password === ''}>{busy ? t('signingIn') : t('signIn')}</button>
                    {auth.state === 'offline' ? <button className={css.retry} type="button" onClick={retry}>{t('retry')}</button> : null}
                  </form>
                )
                : loginMode === 'sms'
                  ? <UnavailablePanel icon={<PhoneIcon />} title={t('smsUnavailableTitle')} detail={t('smsUnavailableDetail')} action={t('useAccountLogin')} onAction={() => { changeMode('account') }} />
                  : <UnavailablePanel icon={<QrIcon />} title={t('qrUnavailableTitle')} detail={t('qrUnavailableDetail')} action={t('useAccountLogin')} onAction={() => { changeMode('account') }} qr />}
            <p className={css.legalNotice}>{t('legalPrefix')}<button type="button" disabled>{t('userAgreement')}</button>{t('legalJoin')}<button type="button" disabled>{t('privacyPolicy')}</button></p>
            <p className={css.formFooter}>{t('noAccount')}<button type="button" disabled>{t('requestAccess')}</button></p>
          </div>
        </section>
      </main>
    </div>
  )
}

function Feature({ icon, label }: { icon: ReactNode; label: string }) {
  return <div className={css.featurePill}>{icon}{label}</div>
}

function Capability({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className={css.capabilityItem}>
      <span className={css.capabilityIcon}>{icon}</span>
      <span><strong>{title}</strong><small>{detail}</small></span>
    </div>
  )
}

function UnavailablePanel({
  icon,
  title,
  detail,
  action,
  onAction,
  qr = false,
}: {
  icon: ReactNode
  title: string
  detail: string
  action: string
  onAction: () => void
  qr?: boolean
}) {
  return (
    <div className={css.unavailablePanel} role="tabpanel">
      <span className={qr ? css.qrPlaceholder : css.unavailableIcon}>{icon}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
      <button type="button" onClick={onAction}>{action}</button>
    </div>
  )
}
function FileIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h4" /></svg> }
function SearchIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg> }
function FlowIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.5 6H13a5 5 0 0 1 5 5v4.5M15.5 18H11a5 5 0 0 1-5-5V8.5" /></svg> }
function ServerIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="6" rx="1.5" /><rect x="4" y="14" width="16" height="6" rx="1.5" /><path d="M8 7h.01M8 17h.01" /></svg> }
function PhoneIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M10 18h4" /></svg> }
function QrIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM15 14h2v2h-2zM19 14h2v4h-2zM14 19h4v2h-4zM20 20h1v1h-1z" /></svg> }
