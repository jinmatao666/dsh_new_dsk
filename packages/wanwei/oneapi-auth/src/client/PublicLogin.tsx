import { LoginDialog } from './LoginDialog.tsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import css from './AuthGate.module.css'
import styles from './PublicLogin.module.css'

/** Runtime callbacks and labels for the existing login card. */
export interface PublicLoginProps {
  mode: 'sms' | 'qr' | 'reset'
  request: (operation: string, input: Record<string, string>, signal?: AbortSignal) => Promise<unknown>
  onBack: () => void
  t: (key: string) => string
}
interface Result {
  state?: string
  success?: boolean
  code?: string
  register_enabled?: boolean
  status?: string
  message?: string
  data?: Record<string, unknown>
}
interface Capabilities {
  sms: boolean
  reset: boolean
  register: boolean
  wechat: boolean
  captcha: boolean
  agreement: string
  privacy: string
}

/** Login and registration stay inside the existing card; no separate registration page. */
export function PublicLogin({ mode, request: rawRequest, onBack, t }: PublicLoginProps) {
  const abort = useRef(new AbortController())
  const request = useCallback((operation: string, input: Record<string, string>, signal?: AbortSignal) =>
    rawRequest(operation, input, signal ? AbortSignal.any([abort.current.signal, signal]) : abort.current.signal), [rawRequest])
  const [cap, setCap] = useState<Capabilities>()
  const [phone, setPhone] = useState(''), [code, setCode] = useState('')
  const [password, setPassword] = useState(''), [confirm, setConfirm] = useState('')
  const [register, setRegister] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [captcha, setCaptcha] = useState<{ captcha_id: string; captcha_image: string }>()
  const [imageCode, setImageCode] = useState('')
  const [qr, setQr] = useState<{ state: string; image: string }>(), [unbound, setUnbound] = useState('')
  const [wechatPhone, setWechatPhone] = useState('')
  const live = useRef(true), polling = useRef(false)
  useEffect(() => {
    live.current = true
    if (abort.current.signal.aborted) abort.current = new AbortController()
    void request('capabilities', {}).then((result) => {
      const data = (result as Result).data as unknown as Capabilities
      if (live.current) setCap(data)
    }).catch((e: unknown) => { if (live.current) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live.current = false; abort.current.abort() }
  }, [request])
  useEffect(() => {
    if (!countdown) return
    const timer = window.setTimeout(() => { setCountdown(value => value - 1) }, 1000)
    return () => { window.clearTimeout(timer) }
  }, [countdown])
  const run = async (operation: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await operation() } catch (e) { if (live.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (live.current) setBusy(false) }
  }
  const loadQr = () => { void run(async () => {
    setUnbound(''); setWechatPhone(''); const result = await request('qr', {}) as Result
    if (live.current) setQr(result.data as unknown as { state: string; image: string })
  }) }
  useEffect(() => {
    if (mode !== 'qr' || !cap?.wechat) return
    loadQr()
  }, [mode, cap?.wechat])
  useEffect(() => {
    if (!qr || unbound) return
    let active = true
    const pollAbort = new AbortController()
    const timer = window.setInterval(() => {
      if (polling.current) return
      polling.current = true
      void request('poll', { state: qr.state }, pollAbort.signal).then((result) => {
        if (!active) return
        const value = result as Result
        if (value.status === 'unbound') { setUnbound(qr.state); setQr(undefined) }
        else if (value.status === 'need_bind_phone') { setWechatPhone(qr.state); setQr(undefined) }
        else if (value.status === 'expired' || value.status === 'error') { setQr(undefined); setError(value.message || t('loginQrExpired')) }
      }).catch((e: unknown) => { if (active) { setQr(undefined); setError(e instanceof Error ? e.message : String(e)) } })
        .finally(() => { polling.current = false })
    }, 2000)
    return () => { active = false; pollAbort.abort(); window.clearInterval(timer) }
  }, [qr, unbound, request, t])
  const smsEnabled = mode === 'reset' || wechatPhone ? cap?.reset : cap?.sms
  const smsForm = mode !== 'qr' || !!unbound || !!wechatPhone
  useEffect(() => {
    if (cap && (!smsEnabled && smsForm || mode === 'qr' && !cap.wechat)) {
      setError(t(mode === 'qr' ? 'loginWechatDisabled' : 'loginSmsDisabled'))
    }
  }, [cap, smsEnabled, smsForm, mode, t])
  const send = () => { void run(async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) throw new Error(t('securityInvalidPhone'))
    if (cap?.captcha && !wechatPhone && !captcha) {
      const result = await request('captcha', {}) as Result; setCaptcha(result.data as unknown as { captcha_id: string; captcha_image: string }); return
    }
    try {
      await request(wechatPhone ? 'wechat-phone-send' : 'send', { phone, state: wechatPhone, purpose: mode === 'reset' ? 'phone_reset_password' : 'phone_login',
        captcha_id: captcha?.captcha_id || '', captcha_code: imageCode })
    } catch (error) { setCaptcha(undefined); setImageCode(''); throw error }
    setCountdown(60); setNotice(t('securityCodeSent')); setCaptcha(undefined); setImageCode('')
  }) }
  const submit = (event: FormEvent) => { event.preventDefault(); void run(async () => {
    if (register || mode === 'reset') {
      if ((mode === 'reset' || password) && (password.length < 8 || password.length > 20 || password !== confirm)) throw new Error(t('securityPasswordInvalid'))
    }
    if (register && (!cap?.agreement || !cap.privacy)) throw new Error(t('loginConsentRequired'))
    const input = { phone, code, password, new_password: password, agreed: 'true', wechat_state: unbound, state: wechatPhone }
    const result = await request(wechatPhone ? 'wechat-phone-bind' : mode === 'reset' ? 'reset' : register ? 'register' : 'sms', input) as Result
    if (result.code === 'phone_not_registered') {
      if (!result.register_enabled) throw new Error(result.message || t('loginRegistrationClosed'))
      if (!cap?.agreement || !cap.privacy) throw new Error(t('loginConsentRequired'))
      await request('register', { ...input, password: '', agreed: 'true' }); return
    }
    if (mode === 'reset') { setPassword(''); setConfirm(''); setCode(''); setNotice(t('loginPasswordSaved')) }
  }) }
  return <div className={styles.body} data-login-mode={mode} data-register={register ? 'true' : undefined}>
    {!cap && !error && <p role="status">{t('securityLoading')}</p>}
    {mode === 'qr' && cap?.wechat && !unbound && !wechatPhone && <div className={styles.qr}>
      {qr ? <><img src={qr.image} alt={t('loginQrAlt')} /><p>{t('securityScanHint')}</p></> : <p>{t(busy ? 'securityLoading' : 'loginQrExpired')}</p>}
      <button type="button" disabled={busy} onClick={loadQr}>{t('loginRefreshQr')}</button>
    </div>}
    {wechatPhone && <p>{t('loginBindPhoneAfterScan')}</p>}
    {unbound && <p>{t('loginBindExisting')}</p>}
    {cap && smsEnabled && smsForm && <form className={styles.form} data-register={register ? 'true' : undefined} onSubmit={submit}>
      {register ? <><h3>{t('loginCreateAccount')}</h3><p>{t('loginAccountPhone')} {phone}</p></> : <label>{t('securityPhone')}<input type="tel" placeholder={t('loginPhonePlaceholder')} autoComplete="tel" maxLength={11} required value={phone} disabled={busy} onChange={(e) => { setPhone(e.target.value); setCode('') }} /></label>}
      {!register && <div className={styles.code}><label>{t('loginSmsCode')}<input inputMode="numeric" placeholder={t('loginCodePlaceholder')} autoComplete="one-time-code" maxLength={6} required value={code} disabled={busy} onChange={(e) =>{  setCode(e.target.value) }} /></label><button type="button" disabled={busy || countdown > 0} onClick={send}>{countdown ? `${countdown}s` : t('securitySendCode')}</button></div>}
      {captcha && <div className={styles.code}><label>{t('securityCaptcha')}<input value={imageCode} onChange={(e) =>{  setImageCode(e.target.value) }} /></label><img src={captcha.captcha_image} alt={t('securityCaptcha')} /></div>}
      {(register || mode === 'reset') && <><p className={styles.hint}>{t(register ? 'loginPasswordOptional' : 'securityPasswordHint')}</p><label>{t('securityNewPassword')}<input type="password" autoComplete="new-password" maxLength={20} required={mode === 'reset'} value={password} onChange={(e) =>{  setPassword(e.target.value) }} /></label><label>{t('securityConfirmPassword')}<input type="password" autoComplete="new-password" maxLength={20} required={mode === 'reset'} value={confirm} onChange={(e) =>{  setConfirm(e.target.value) }} /></label></>}
      {register && <button className={styles.inline} type="button" disabled={busy} onClick={() => { setRegister(false); setCode(''); setPassword(''); setConfirm(''); setNotice('') }}>{t('loginChangePhone')}</button>}
      {mode === 'sms' && !register && <p className={styles.smsHint} role={notice ? 'status' : undefined}>{notice || t('loginCodePrivacyHint')}</p>}
      <button className={css.primaryButton} disabled={busy || register && (!cap.agreement || !cap.privacy)}>{busy ? t('securitySaving') : t(wechatPhone ? 'loginBindPhoneEnter' : mode === 'reset' ? 'securityPasswordAction' : register ? password ? 'loginRegisterEnter' : 'loginSkipPassword' : cap.register ? 'loginOrRegister' : 'signIn')}</button>
    </form>}
    {notice && mode !== 'sms' && <p role="status" className={styles.hint}>{notice}</p>}
    <LoginDialog compact open={!!error} title={t(mode === 'reset' ? 'forgotPassword' : mode === 'qr' ? 'qrLogin' : 'smsLogin')} closeLabel={t('supportClose')} onClose={() => { setError('') }}>
      <p role="alert" className={styles.error}>{error}</p>
    </LoginDialog>
    {!register && mode === 'reset' && <button type="button" className={styles.back} onClick={onBack}>{t('loginBackAccount')}</button>}
  </div>
}
