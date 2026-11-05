import { LegalDocument } from './LegalDocument.tsx'
import type { LegalKind } from './legal-documents.ts'
import { LoginDialog } from './LoginDialog.tsx'
import { PublicLogin } from './PublicLogin.tsx'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AuthState } from '../contract.ts'
import type { DeploymentSettings } from '../deployment.ts'
import type { AuthView } from './controller.ts'
import css from './AuthGate.module.css'

export interface AuthInjected {
  hooks: { auth: HostObservable<AuthView> }
  getSupportContact: () => Promise<DeploymentSettings>
  refresh: (signal?: AbortSignal) => Promise<AuthState>
  login: (username: string, password: string, signal?: AbortSignal) => Promise<AuthState>
  requestAccount?: (operation: string, input?: Record<string, string>) => Promise<unknown>
  publicAuth?: (operation: string, input: Record<string, string>, signal?: AbortSignal) => Promise<unknown>
  fail: (error: unknown) => void
}

export type AuthGateProps = PropsRuntime<'shell.overlay'>
  & InjectFace<AuthInjected>
  & PropsLocale<'wanwei.auth'>

const NATIVE_AUTH_SIGNAL_PREFIX = '__zjugis_native_auth:'
const REMEMBERED_ACCOUNT_KEY = 'wanwei.auth.remembered-account'

function readRememberedAccount(): string {
  try { return window.localStorage.getItem(REMEMBERED_ACCOUNT_KEY) ?? '' }
  catch { return '' }
}

type LoginMode = 'account' | 'sms' | 'qr'

/** Blocking login surface; desktop viewports scale one centered 1120×720 layout, and credentials go only to the local Host. */
export function AuthGate({ useAuth, getSupportContact, refresh, login, publicAuth, requestAccount, fail, t }: AuthGateProps) {
  const auth = useAuth(view => view)
  const authenticated = auth.state === 'authenticated'
  const checking = auth.state === 'checking'
  const [username, setUsername] = useState(readRememberedAccount)
  const [rememberMe, setRememberMe] = useState(() => readRememberedAccount() !== '')
  const [loginMode, setLoginMode] = useState<LoginMode | 'reset'>('account')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<{ text: string }>()
  const [legal, setLegal] = useState<LegalKind>()
  const openLegal = (kind: LegalKind) => { setLegal(kind) }
  const [supportOpen, setSupportOpen] = useState(false)
  const [support, setSupport] = useState<DeploymentSettings>()
  const [supportError, setSupportError] = useState<string>()
  const [supportBusy, setSupportBusy] = useState(false)
  const supportTrigger = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const pageRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (auth.state === 'offline') setError(auth.message || t('offline'))
  }, [auth, t])

  useEffect(() => {
    if ('username' in auth) setUsername(auth.username)
  }, [auth])

  useEffect(() => {
    if (!authenticated) return
    setPassword('')
    setError(undefined)
    setLoginMode('account')
    setNotice(undefined)
    setSupportOpen(false)
  }, [authenticated])

  useEffect(() => {
    const dialog = dialogRef.current
    if (supportOpen && dialog !== null && !dialog.open) dialog.showModal()
  }, [supportOpen])

  // The desktop shell watches the document-title marker to switch native
  // window policy: login is fixed-size, while the authenticated app may be
  // resized and maximized. The marker is intentionally product-owned and is
  // ignored by ordinary browser hosts.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('wanwei:auth-state', { detail: { authenticated: auth.state === 'authenticated' } }))
    if (auth.state === 'authenticated') {
      document.title = `${NATIVE_AUTH_SIGNAL_PREFIX}authenticated`
    } else {
      document.title = `${NATIVE_AUTH_SIGNAL_PREFIX}login`
    }
  }, [auth.state])

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
      const scale = Math.min(window.innerWidth / 1120, window.innerHeight / 720, 1.4)
      page.style.setProperty('--login-scale', scale.toFixed(4))
      page.style.setProperty('--login-layout-width', '1120px')
      page.style.setProperty('--login-layout-height', '720px')
    }
    update()
    window.addEventListener('resize', update)
    return () => { window.removeEventListener('resize', update) }
  }, [authenticated])

  if (auth.state === 'authenticated') return auth.passwordSetup && requestAccount
    ? <InitialPassword key={auth.username} request={requestAccount} /> : null

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await login(username, password)
      try {
        if (rememberMe) window.localStorage.setItem(REMEMBERED_ACCOUNT_KEY, username)
        else window.localStorage.removeItem(REMEMBERED_ACCOUNT_KEY)
      } catch { /* Remembering the account must not block successful authentication. */ }
      setPassword('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const retry = (): void => { setError(undefined); void refresh().catch(fail) }
  const serviceError = error
  const changeMode = (mode: LoginMode): void => {
    if (mode === 'qr') { setNotice({ text: t('qrUnavailableTitle') }); return }
    setNotice(undefined); setLoginMode(mode); setError(undefined)
  }
  const openSupport = async (trigger: HTMLButtonElement): Promise<void> => {
    supportTrigger.current = trigger
    setSupportOpen(true); setSupportBusy(true); setSupportError(undefined); setSupport(undefined)
    try { setSupport(await getSupportContact()) }
    catch { setSupportError(t('supportLoadError')) }
    finally { setSupportBusy(false) }
  }
  const closeSupport = (): void => { dialogRef.current?.close(); setSupportOpen(false); supportTrigger.current?.focus() }

  return (
    <div className={css.backdrop}>
      <div className={css.decoBlobOne} aria-hidden="true" />
      <div className={css.decoBlobTwo} aria-hidden="true" />
      <div className={css.decoBlobThree} aria-hidden="true" />
      <main ref={pageRef} className={css.page} aria-label={t('pageLabel')}>
        <section className={css.brandSide} aria-label={t('productIntroLabel')}>
          <div className={css.brandHeader} aria-label={t('productName')}>
            <span className={css.logoText}>
              <img className={css.fullLogo} src="/brand-wordmark.svg" width={250} height={83} alt={t('productName')} />
            </span>
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
          <div className={css.card} data-public-login={loginMode !== 'account' ? 'true' : undefined}>
            <div className={css.cardHeader}><h2>{t('loginTitle')}</h2><p>{t('loginIntro')}</p></div>
            <div className={css.loginMode} role="tablist" aria-label={t('loginMethods')}>
              {(['account', 'sms', 'qr'] as const).map(mode => (
                <button key={mode} type="button" className={mode === loginMode ? css.loginModeActive : undefined} role="tab" aria-selected={mode === loginMode} onClick={() => { changeMode(mode) }}>
                  {t(mode === 'account' ? 'accountLogin' : mode === 'sms' ? 'smsLogin' : 'qrLogin')}
                </button>
              ))}
            </div>
            <div className={css.methodNotice} aria-hidden='true' />
            <div className={css.loginContent}>
              {loginMode === 'account' ? <>
                <form onSubmit={(event) => { void submit(event) }}>
                  <label>{t('username')}<input autoFocus autoComplete="username" disabled={busy} value={username} onChange={(event) => { setUsername(event.target.value) }} placeholder={t('usernamePlaceholder')} required /></label>
                  <label>{t('password')}<input type="password" autoComplete="current-password" disabled={busy} value={password} onChange={(event) => { setPassword(event.target.value) }} placeholder={t('passwordPlaceholder')} required /></label>
                  <div className={css.formOptions}>
                    <label className={css.remember}><input type="checkbox" checked={rememberMe} disabled={busy} onChange={(event) => {
                      setRememberMe(event.target.checked)
                      if (!event.target.checked) {
                        try { window.localStorage.removeItem(REMEMBERED_ACCOUNT_KEY) } catch { /* Storage may be unavailable. */ }
                      }
                    }} />{t('rememberMe')}</label>
                    <button className={css.textAction} type="button" onClick={() =>{  setLoginMode('reset') }}>{t('forgotPassword')}</button>
                  </div>
                  <button className={css.primaryButton} type="submit" disabled={checking || busy || username.trim() === '' || password === ''}>{checking ? t('checking') : busy ? t('signingIn') : t('signIn')}</button>
                </form>
              </>
                : publicAuth ? <PublicLogin key={loginMode} mode={loginMode} request={publicAuth} onBack={() =>{  setLoginMode('account') }} t={key => t(key as import('./locales.ts').WanweiAuthKey)} /> : <p>{t('loginServiceMissing')}</p>}

            </div>
            {loginMode === 'account' && <p className={css.registrationFooter}><span>{t('loginNoAccount')}</span><button type="button" onClick={() =>{  setLoginMode('sms') }}>{t('loginPhoneRegister')}</button></p>}
            {loginMode === 'sms' && <p className={css.registrationFooter}>{t('loginUnregisteredHint')}</p>}
            {(loginMode === 'account' || loginMode === 'sms') && <p className={css.legalNotice}>{t('legalPrefix')}<button type="button" onClick={() => {  openLegal('agreement') }}>{t('userAgreement')}</button>{t('legalJoin')}<button type="button" onClick={() => {  openLegal('privacy') }}>{t('privacyPolicy')}</button></p>}
            <p className={css.footerSpace}>{t('accountHelpPrefix')}<button className={css.textAction} type="button" onClick={(event) => { void openSupport(event.currentTarget) }}>{t('administrator')}</button>{t('accountHelpSuffix')}</p>
          </div>
        </section>
      </main>
      <LoginDialog compact open={serviceError !== undefined || notice !== undefined} title={t('productName')}
        closeLabel={t('supportClose')} onClose={() => { setError(undefined); setNotice(undefined) }}>
        <p className={serviceError !== undefined ? css.error : undefined} role={serviceError !== undefined ? 'alert' : 'status'}>{serviceError ?? notice?.text}</p>
        {serviceError !== undefined && auth.state === 'offline' && <button className={css.textAction} type="button" onClick={retry}>{t('retry')}</button>}
      </LoginDialog>
      <LoginDialog open={legal !== undefined} title={t(legal === 'privacy' ? 'privacyPolicy' : 'userAgreement')}
        closeLabel={t('supportClose')} onClose={() => { setLegal(undefined) }}>
        {legal && <LegalDocument kind={legal} />}
      </LoginDialog>
      {supportOpen && <dialog ref={dialogRef} className={css.supportDialog} aria-labelledby='wanwei-support-title' onCancel={() => { setSupportOpen(false); supportTrigger.current?.focus() }} onClose={() => { setSupportOpen(false); supportTrigger.current?.focus() }}>
        <h2 id='wanwei-support-title'>{t('supportTitle')}</h2>
        <p>{t('supportHint')}</p>
        {supportBusy ? <p role='status'>{t('supportLoading')}</p> : supportError !== undefined ? <p role='alert'>{supportError}</p> : support !== undefined ? <dl>
          <div><dt>{t('supportOperator')}</dt><dd>{support.operator || t('supportNotConfigured')}</dd></div>
          <div><dt>{t('supportPhone')}</dt><dd>{support.phone || t('supportNotConfigured')}</dd></div>
        </dl> : null}
        <button type='button' onClick={closeSupport} autoFocus>{t('supportClose')}</button>
      </dialog>}
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

function FileIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h4" /></svg> }
function SearchIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg> }
function FlowIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.5 6H13a5 5 0 0 1 5 5v4.5M15.5 18H11a5 5 0 0 1-5-5V8.5" /></svg> }
function ServerIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="6" rx="1.5" /><rect x="4" y="14" width="16" height="6" rx="1.5" /><path d="M8 7h.01M8 17h.01" /></svg> }

function InitialPassword({ request }: { request: NonNullable<AuthInjected['requestAccount']> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [closed, setClosed] = useState(false)
  const [password, setPassword] = useState(''), [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { if (!closed) dialog.current?.showModal() }, [closed])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  if (closed) return null
  return <dialog ref={dialog} className={css.initialPassword}
    onCancel={(event) => { if (busy) event.preventDefault(); else setClosed(true) }}>
    <h2>设置登录密码</h2><p>账号已创建并登录。可设置密码，也可稍后在“设置 → 账户”中设置。</p>
    <form onSubmit={(event) => { event.preventDefault(); void run(async () => {
      if (password.length < 8 || password.length > 20 || password !== confirm) throw new Error('请输入8–20位密码，并确保两次输入一致')
      await request('initial-password', { new_password: password }); setClosed(true)
    }) }}>
      <label>新密码<input type="password" placeholder="请输入8–20位密码" maxLength={20} required autoComplete="new-password" value={password} onChange={(e) =>{  setPassword(e.target.value) }} disabled={busy} /></label>
      <label>确认密码<input type="password" placeholder="请再次输入密码" maxLength={20} required autoComplete="new-password" value={confirm} onChange={(e) =>{  setConfirm(e.target.value) }} disabled={busy} /></label>
      <LoginDialog compact open={!!error} title="设置登录密码" closeLabel="关闭" onClose={() => { setError('') }}><p role="alert" className={css.error}>{error}</p></LoginDialog><footer><button type="button" disabled={busy} onClick={() =>{  setClosed(true) }}>稍后设置</button><button disabled={busy}>保存密码</button></footer>
    </form>
  </dialog>
}
