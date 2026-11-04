import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AuthState } from '../contract.ts'
import type { AccountSecurity } from '../contract.ts'
import type { AuthView } from './controller.ts'
import css from './AccountSection.module.css'

export interface AccountInjected {
  hooks: { auth: HostObservable<AuthView> }
  logout: () => Promise<AuthState>
  requestAccount: (operation: string, input?: Record<string, string>) => Promise<unknown>
}
export type AccountSectionProps = PropsRuntime<'settings.section'> & InjectFace<AccountInjected> & PropsLocale<'wanwei.auth'>

/** Account identity and verified phone, password and WeChat management. */
export function AccountSection({ useAuth, logout, requestAccount, close, t }: AccountSectionProps) {
  const auth = useAuth(view => view)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState('')
  const [data, setData] = useState<AccountSecurity>()
  const [mode, setMode] = useState<'phone' | 'password' | 'wechat'>()
  const [values, setValues] = useState<Record<string, string>>({})
  const [qr, setQr] = useState<{ state: string; image: string }>()
  const [scanned, setScanned] = useState(false)
  const [cooldown, setCooldown] = useState<Record<string, number>>({})
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let live = true
    setData(undefined); setMode(undefined); setValues({}); setError(undefined)
    if (auth.state === 'authenticated') void requestAccount('status').then((value) => { if (live) setData(value as AccountSecurity) })
      .catch((cause: unknown) => { if (live) setError(String(cause instanceof Error ? cause.message : cause)) })
    return () => { live = false }
  }, [auth.state, auth.state === 'authenticated' ? auth.username : undefined, requestAccount, revision])
  useEffect(() => {
    const timer = window.setInterval(() => {
      setCooldown(old => Object.fromEntries(Object.entries(old).map(([key, value]) => [key, Math.max(0, value - 1)])))
    }, 1000)
    return () => { window.clearInterval(timer) }
  }, [])
  useEffect(() => {
    if (!qr || mode !== 'wechat' || scanned) return
    let live = true, pending = false
    const timer = window.setInterval(() => {
      if (pending) return
      pending = true
      void requestAccount('wechat-poll', { state: qr.state }).then((value) => {
        if (!live) return
        const result = value as { status: string; message?: string }
        if (result.status === 'unbound') setScanned(true)
        else if (result.status !== 'pending') { setQr(undefined); setError(result.message || t('securityQrBound')) }
      }).catch((cause: unknown) => { if (live) { setQr(undefined); setError(String(cause instanceof Error ? cause.message : cause)) } })
        .finally(() => { pending = false })
    }, 2000)
    return () => { live = false; window.clearInterval(timer) }
  }, [qr, mode, scanned, requestAccount, t])
  const dismiss = () => {
    setMode(undefined); setValues({}); setQr(undefined); setError(undefined); setNotice('')
  }
  useEffect(() => {
    if (!mode || !dialogRef.current) return
    const dialog = dialogRef.current
    dialog.showModal()
    dialog.querySelector('input')?.focus()
    return () => { dialog.close(); triggerRef.current?.focus() }
  }, [mode])
  const execute = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError(undefined); setNotice('')
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }
  const edit = (next: typeof mode) => {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void execute(async () => {
      setMode(next); setValues({}); setQr(undefined); setScanned(false)
      if (next === 'wechat' && !data?.wechatBound) setQr(await requestAccount('wechat-qr') as { state: string; image: string })
    }) }
  const sendCode = (target: 'new' | 'current') => { void execute(async () => {
    const operation = target === 'new' ? 'send-new' : mode === 'password' ? 'send-password' : 'send-current'
    const cooldownKey = operation
    if (cooldown[cooldownKey]) return
    if (target === 'new' && !/^1[3-9]\d{9}$/.test(values.phone || '')) throw new Error(t('securityInvalidPhone'))
    await requestAccount(operation, { phone: values.phone || '' })
    setCooldown(old => ({ ...old, [cooldownKey]: 60 })); setNotice(t('securityCodeSent'))
  }) }
  const submit = (event: FormEvent) => { event.preventDefault(); void execute(async () => {
    if (!data || !mode) return
    if (mode === 'password' && (values.password !== values.confirm || !values.password || values.password.length < 8 || values.password.length > 20)) throw new Error(t('securityPasswordInvalid'))
    if (mode === 'wechat' && !data.wechatBound && !scanned) throw new Error(t('securityScanFirst'))
    const operation = mode === 'phone' ? data.phoneBound ? 'phone-replace' : 'phone-bind' : mode === 'password' ? 'password' : data.wechatBound ? 'wechat-unbind' : 'wechat-bind'
    const input = mode === 'phone' ? data.phoneBound ? { old_code: values.old_code || '', new_phone: values.phone || '', new_code: values.code || '' } : { phone: values.phone || '', code: values.code || '' }
      : mode === 'password' ? { code: values.code || '', new_password: values.password || '' }
        : data.wechatBound ? { code: values.code || '' } : { state: qr?.state || '', phone_code: values.code || '' }
    await requestAccount(operation, input); setMode(undefined); setValues({}); setQr(undefined); setNotice(t('securitySaved')); setRevision(value => value + 1)
  }) }
  const field = (key: string, label: string, type = 'text') => <label className={css.field}>{label}<input required type={type} value={values[key] || ''} autoComplete={type === 'password' ? 'new-password' : 'off'} maxLength={key === 'phone' ? 11 : type === 'password' ? 20 : 12} onChange={(event) => { setValues(old => ({ ...old, [key]: event.target.value })) }} /></label>
  const codeButton = (target: 'new' | 'current') => {
    const key = target === 'new' ? 'send-new' : mode === 'password' ? 'send-password' : 'send-current'
    return <button type="button" className={css.secondary} disabled={busy || !!cooldown[key]} onClick={() => { sendCode(target) }}>{cooldown[key] ? `${cooldown[key]}s` : t('securitySendCode')}</button>
  }
  const blocked = busy || !data || auth.state !== 'authenticated'
  const rows = [
    { key: 'phone' as const, title: t('securityPhone'), detail: data ? data.phoneBound ? data.phone : t('securityPhoneHint') : t('securityLoading'), action: data?.phoneBound ? t('securityReplacePhone') : t('securityBindPhone'), path: 'M8 2h8v20H8z M11 18h2' },
    { key: 'password' as const, title: t('securityPassword'), detail: t('securityPasswordHint'), action: t('securityPasswordAction'), path: 'M7 10V7a5 5 0 0110 0v3 M5 10h14v12H5z M12 14v4' },
    { key: 'wechat' as const, title: t('securityWechat'), detail: data ? data.wechatBound ? t('securityWechatBound') : t('securityWechatHint') : t('securityLoading'), action: data?.wechatBound ? t('securityUnbindWechat') : t('securityBindWechat'), path: 'M21 11a8 8 0 01-8 8H7l-4 3v-6a8 8 0 118-13 M8 10h.1 M15 10h.1' },
  ]
  return <section className={css.section}>
    <h1>{t('accountTitle')}</h1><p className={css.hint}>{t('securityIntro')}</p>
    <div className={css.card}><div className={css.identity}><span className={css.avatar} aria-hidden="true">{auth.state === 'authenticated' ? auth.username?.slice(0, 1).toUpperCase() || 'W' : 'W'}</span><div><div className={css.label}>{t('signedInAs')}</div><div className={css.value}>{auth.state === 'authenticated' ? auth.username || t('signedInFallback') : t('loggedOut')}</div></div></div>
      {auth.state === 'authenticated' && <button type="button" className={css.logout} disabled={busy} onClick={() => { void execute(async () => { setSigningOut(true); try { await logout(); close() } finally { setSigningOut(false) } }) }}>{signingOut ? t('signingOut') : t('signOut')}</button>}
    </div>
    <h2 className={css.subheading}>{t('securityTitle')}</h2>
    <div className={css.security}>{rows.map(row => <div key={row.key} className={css.row}><span className={css.icon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d={row.path} /></svg></span><div className={css.description}><h3>{row.title}</h3><p>{row.detail}</p></div><button className={css.secondary} disabled={blocked || row.key !== 'phone' && !data?.phoneBound} type="button" onClick={() => { edit(row.key) }}>{row.action}</button></div>)}</div>
    {data && !data.phoneBound && <p className={css.hint}>{t('securityBindFirst')}</p>}
    {!mode && error && <div role="alert" className={css.error}>{error}<button type="button" className={css.secondary} disabled={busy} onClick={() => { setRevision(value => value + 1) }}>{t('securityRetry')}</button></div>}
    {!mode && notice && <p role="status" className={css.success}>{notice}</p>}
    {mode && data && <dialog ref={dialogRef} className={css.dialog} aria-modal="true" aria-labelledby="account-security-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) dismiss() }}>
      <form className={css.form} onSubmit={submit}>
        <header className={css.dialogHeader}><div><h2 id="account-security-title">{rows.find(row => row.key === mode)?.action}</h2><p>{t('securityDialogHint')}</p></div>
          <button type="button" className={css.closeButton} aria-label={t('securityCancel')} disabled={busy} onClick={dismiss}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></header>
        {error && <p role="alert" className={css.error}>{error}</p>}
        {notice && <p role="status" className={css.success}>{notice}</p>}
        {mode === 'wechat' && data.wechatBound && <p className={css.hint}>{t('securityUnbindHint')}</p>}
        {mode === 'wechat' && qr && <div className={css.qr}><img src={qr.image} alt={t('securityWechatQr')} /><p>{scanned ? t('securityScanned') : t('securityScanHint')}</p></div>}
        {mode === 'phone' && field('phone', t('securityNewPhone'), 'tel')}
        {mode === 'phone' && data.phoneBound && <div className={css.codeRow}>{field('old_code', t('securityOldCode'))}{codeButton('current')}</div>}
        <div className={css.codeRow}>{field('code', mode === 'phone' ? t('securityNewCode') : t('securitySmsCode'))}{codeButton(mode === 'phone' ? 'new' : 'current')}</div>
        {mode === 'password' && <>{field('password', t('securityNewPassword'), 'password')}{field('confirm', t('securityConfirmPassword'), 'password')}</>}
        <div className={css.formActions}><button type="button" className={css.secondary} disabled={busy} onClick={dismiss}>{t('securityCancel')}</button><button className={css.primary} disabled={busy || mode === 'wechat' && !data.wechatBound && !scanned}>{busy ? t('securitySaving') : t('securityConfirm')}</button></div>
      </form></dialog>}
  </section>
}
