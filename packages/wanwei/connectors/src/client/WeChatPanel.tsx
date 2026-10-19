import { useEffect, useRef, useState } from 'react'
import { getCachedWeChatStatus, setCachedWeChatStatus } from './wechat-status-cache.ts'
import { productText } from './locales/product.ts'

/** Non-secret WeChat Assistant status from Host. */
export type WeChatStatus = {
  authed: boolean
  bridgeRunning: boolean
  hint: string | null
}

/** Result of starting an in-app QR login. */
export type WeChatLoginStart = {
  sessionKey: string
  qrcodeUrl: string
  qrDataUrl: string
  status: WeChatStatus
}

/** One Host poll while the QR modal is open. */
export type WeChatLoginPoll = {
  phase: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'need_verifycode' | 'error'
  status: WeChatStatus
  message: string | null
  qrcodeUrl: string | null
  qrDataUrl: string | null
}

/** Host RPC face for WeChat Assistant remote channel. */
export type WeChatApi = {
  status: () => Promise<WeChatStatus>
  loginStart: () => Promise<WeChatLoginStart>
  loginPoll: (sessionKey: string, verifyCode?: string) => Promise<WeChatLoginPoll>
  disconnect: () => Promise<WeChatStatus>
}

/** Example prompts shown under 试试这样用 (phone-side interaction). */
export const WECHAT_EXAMPLE_PROMPTS = [
  '帮我打开百度',
  '把桌面上的周报草稿整理成三条要点发回微信',
  '查一下本机今天改过的文档，列一份简短清单',
] as const

/**
 * WorkBuddy-style WeChat Assistant sheet: 连接 → in-app QR → 取消连接.
 * @param props.api - Host RPC callbacks.
 * @param props.onTry - Stage a prompt in desktop chat (optional; primary use is phone chat).
 * @param props.initialStatus - Last-known status for instant paint while a soft refresh runs.
 * @param props.onNotice - Transient success/error feedback after connect or unbind.
 */
export function WeChatPanel({
  api,
  onTry,
  initialStatus,
  onNotice,
}: {
  api: WeChatApi
  onTry?: (prompt: string) => void
  initialStatus?: WeChatStatus | null
  onNotice?: (notice: { kind: 'success' | 'error' | 'info'; text: string }) => void
}) {
  const seed = initialStatus ?? getCachedWeChatStatus()
  const [status, setStatus] = useState<WeChatStatus | null>(seed)
  const [busy, setBusy] = useState<'idle' | 'load' | 'login' | 'disconnect'>(seed !== null ? 'idle' : 'load')
  const [error, setError] = useState<string | null>(null)
  const [qrOpen, setQrOpen] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrHint, setQrHint] = useState<string | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [needVerify, setNeedVerify] = useState(false)
  const sessionKeyRef = useRef<string | null>(null)
  const pollCancelledRef = useRef(false)

  const applyStatus = (next: WeChatStatus) => {
    setCachedWeChatStatus(next)
    setStatus(next)
  }

  const refresh = async (mode: 'hard' | 'soft' = 'hard') => {
    if (mode === 'hard') setBusy('load')
    setError(null)
    try {
      applyStatus(await api.status())
    } catch (err) {
      setError(err instanceof Error ? err.message : productText('状态加载失败'))
    } finally {
      setBusy('idle')
    }
  }

  useEffect(() => {
    void refresh(seed !== null ? 'soft' : 'hard')
  }, [])

  useEffect(() => () => {
    pollCancelledRef.current = true
  }, [])

  const closeQr = () => {
    pollCancelledRef.current = true
    sessionKeyRef.current = null
    setQrOpen(false)
    setQrDataUrl(null)
    setQrHint(null)
    setNeedVerify(false)
    setVerifyCode('')
  }

  const pollUntilDone = async (sessionKey: string) => {
    while (!pollCancelledRef.current && sessionKeyRef.current === sessionKey) {
      const tick = await api.loginPoll(sessionKey)
      if (pollCancelledRef.current || sessionKeyRef.current !== sessionKey) return
      applyStatus(tick.status)
      if (tick.qrDataUrl) setQrDataUrl(tick.qrDataUrl)
      if (tick.message) setQrHint(tick.message)
      if (tick.phase === 'need_verifycode') {
        setNeedVerify(true)
        // Wait for the user to submit digits via onSubmitVerify; keep polling lightly.
        await new Promise(resolve => setTimeout(resolve, 1_200))
        continue
      }
      if (tick.phase === 'confirmed') {
        closeQr()
        setBusy('idle')
        onNotice?.({ kind: 'success', text: productText('微信助理已连接') })
        return
      }
      if (tick.phase === 'expired' || tick.phase === 'error') {
        setError(tick.message ?? productText('连接失败，请重试'))
        onNotice?.({ kind: 'error', text: tick.message ?? productText('连接失败，请重试') })
        closeQr()
        setBusy('idle')
        return
      }
    }
  }

  const onConnect = async () => {
    setBusy('login')
    setError(null)
    pollCancelledRef.current = false
    try {
      const started = await api.loginStart()
      applyStatus(started.status)
      sessionKeyRef.current = started.sessionKey
      setQrDataUrl(started.qrDataUrl)
      setQrHint(productText('微信扫一扫'))
      setQrOpen(true)
      await pollUntilDone(started.sessionKey)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      onNotice?.({ kind: 'error', text: message })
      closeQr()
      await refresh('soft').catch(() => {})
      setBusy('idle')
    }
  }

  const onSubmitVerify = async () => {
    const sessionKey = sessionKeyRef.current
    if (sessionKey === null || verifyCode.trim() === '') return
    setQrHint(productText('正在验证配对码…'))
    try {
      const tick = await api.loginPoll(sessionKey, verifyCode.trim())
      applyStatus(tick.status)
      if (tick.qrDataUrl) setQrDataUrl(tick.qrDataUrl)
      if (tick.message) setQrHint(tick.message)
      if (tick.phase === 'confirmed') {
        closeQr()
        setBusy('idle')
        onNotice?.({ kind: 'success', text: productText('微信助理已连接') })
        return
      }
      if (tick.phase === 'need_verifycode') setNeedVerify(true)
      else void pollUntilDone(sessionKey)
    } catch (err) {
      setQrHint(err instanceof Error ? err.message : String(err))
    }
  }

  const onDisconnect = async () => {
    setBusy('disconnect')
    setError(null)
    try {
      applyStatus(await api.disconnect())
      onNotice?.({ kind: 'success', text: productText('微信助理已取消连接') })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      onNotice?.({ kind: 'error', text: message })
    } finally {
      setBusy('idle')
    }
  }

  const ready = status?.authed === true

  return (
    <div className="dsh-connector-dingtalk">
      <div className="dsh-connector-dingtalk-brand" aria-hidden="true">
        <span className="dsh-connector-dingtalk-brand-wanwei">{productText('WB')}</span>
        <span className="dsh-connector-dingtalk-brand-dots">···</span>
        <img src="/connector-icons/wechat.svg" alt="" width={40} height={40} />
      </div>
      <p className="dsh-connector-dingtalk-desc">
        {productText('通过微信直接下发指令，结果实时回传至微信聊天窗口。')}
      </p>
      {status !== null && !ready && busy !== 'login' && status.hint !== null && status.hint !== '' && (
        <p className="dsh-connector-dingtalk-hint">{status.hint}</p>
      )}
      {ready && (
        <p className="dsh-connector-dingtalk-hint">
          {productText('已连接。用手机微信给助理发消息，即可远程指挥本机执行任务。')}
        </p>
      )}
      {error !== null && <p className="dsh-connector-dingtalk-error" role="alert">{error}</p>}
      <div className="dsh-connector-dingtalk-actions">
        {ready ? (
          <>
            <button
              type="button"
              disabled={busy === 'login' || busy === 'disconnect'}
              onClick={() => onTry?.(WECHAT_EXAMPLE_PROMPTS[0])}
            >
              {productText('去试试')}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy === 'login' || busy === 'disconnect'}
              onClick={() => { void onDisconnect() }}
            >
              {busy === 'disconnect' ? productText('正在断开…') : productText('取消连接')}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy === 'load' || busy === 'login' || busy === 'disconnect'}
            onClick={() => { void onConnect() }}
          >
            {busy === 'login' ? productText('等待授权…') : productText('连接')}
          </button>
        )}
      </div>
      <section className="dsh-connector-dingtalk-examples" aria-label={productText('试试这样用')}>
        <h3>{productText('试试这样用')}</h3>
        <ul>
          {WECHAT_EXAMPLE_PROMPTS.map(key => (
            <li key={key}>
              <button
                type="button"
                className="dsh-connector-dingtalk-example"
                disabled={!ready || busy === 'login' || busy === 'disconnect'}
                onClick={() => onTry?.(productText(key))}
              >
                <span>{productText('“')}{productText(key)}{productText('”')}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {qrOpen && (
        <div
          className="dsh-connector-wechat-qr-backdrop"
          onMouseDown={event => {
            if (event.currentTarget === event.target) {
              closeQr()
              setBusy('idle')
            }
          }}
        >
          <section className="dsh-connector-wechat-qr" aria-label={productText('微信助理')}>
            <header>
              <h3>{productText('微信助理')}</h3>
              <button
                type="button"
                aria-label={productText('关闭')}
                onClick={() => {
                  closeQr()
                  setBusy('idle')
                }}
              >
                ×
              </button>
            </header>
            <p className="dsh-connector-wechat-qr-title">{qrHint ?? productText('微信扫一扫')}</p>
            {qrDataUrl !== null && (
              <img className="dsh-connector-wechat-qr-image" src={qrDataUrl} alt={productText('微信扫一扫')} width={240} height={240} />
            )}
            {needVerify && (
              <div className="dsh-connector-wechat-verify">
                <input
                  value={verifyCode}
                  onChange={event => { setVerifyCode(event.target.value) }}
                  placeholder={productText('输入手机显示的配对码')}
                  inputMode="numeric"
                />
                <button type="button" onClick={() => { void onSubmitVerify() }}>
                  {productText('确认')}
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
