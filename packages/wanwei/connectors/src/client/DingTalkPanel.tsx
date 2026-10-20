import { useEffect, useState } from 'react'
import { waitForConnectorAuthorization } from './authorize-wait.ts'
import { getCachedDingTalkStatus, setCachedDingTalkStatus } from './status-cache.ts'
import { productText } from './locales/product.ts'

/** Non-secret DWS + skill status from Host. */
export type DingTalkStatus = {
  dwsInstalled: boolean
  dwsVersion: string | null
  authed: boolean
  skillInstalled: boolean
  hint: string | null
  /** True while the Host login process is still running after the RPC returned. */
  authorizing?: boolean
  /** CLI failure from that background login, or null. */
  authorizeError?: string | null
}

/** Host RPC face for desktop DingTalk skill connection. */
export type DingTalkApi = {
  status: () => Promise<DingTalkStatus>
  login: () => Promise<DingTalkStatus>
  installSkill: () => Promise<DingTalkStatus>
  disconnect: () => Promise<DingTalkStatus>
}

/** Example prompts shown under 试试这样用 (WorkBuddy-compatible). */
export const DINGTALK_EXAMPLE_PROMPTS = [
  '在钉钉群【产品周会】里用机器人发一条通知：今天 15:00 在 3 楼会议室开周会，记得带上周的进展材料',
  '查一下我下周的钉钉日程，列出和【客户对接】相关的会议（时间、参会人、会议室），并帮我找出三人都空闲的时段约一次同步会',
  '在钉钉 AI 表格【任务跟踪】里新增一行：标题=Q2 上线评审、负责人=张三、截止时间=2026-05-20、状态=进行中',
] as const

/**
 * WorkBuddy-style DingTalk connect sheet: 连接 → browser OAuth → 去试试 / 解绑.
 * @param props.api - Host RPC callbacks.
 * @param props.onTry - Stage a prompt in desktop chat and leave the connectors page.
 * @param props.initialStatus - Last-known status for instant paint while a soft refresh runs.
 * @param props.onNotice - Transient success/error feedback after connect or unbind.
 */
export function DingTalkPanel({
  api,
  onTry,
  initialStatus,
  onNotice,
}: {
  api: DingTalkApi
  onTry?: (prompt: string) => void
  initialStatus?: DingTalkStatus | null
  onNotice?: (notice: { kind: 'success' | 'error' | 'info'; text: string }) => void
}) {
  const seed = initialStatus ?? getCachedDingTalkStatus()
  const [status, setStatus] = useState<DingTalkStatus | null>(seed)
  // Keep actions interactive when we already know connected/disconnected; only hard-block on cold load.
  const [busy, setBusy] = useState<'idle' | 'load' | 'login' | 'disconnect'>(seed !== null ? 'idle' : 'load')
  const [error, setError] = useState<string | null>(null)

  const applyStatus = (next: DingTalkStatus) => {
    setCachedDingTalkStatus(next)
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

  /**
   * Single「连接」action: Host runs `dws auth login` (browser QR / avatar),
   * then installs the skill. Matches WorkBuddy (no separate「启用技能」).
   */
  const onConnect = async () => {
    setBusy('login')
    setError(null)
    try {
      // Always go through Host `login`: it opens the browser when unauthenticated,
      // and only copies the skill when CLI auth is already present.
      const started = await api.login()
      applyStatus(started)
      const next = started.authorizing === true
        ? await waitForConnectorAuthorization(() => api.status())
        : started
      applyStatus(next)
      if (next.authed && next.skillInstalled) {
        onNotice?.({ kind: 'success', text: productText('钉钉已连接') })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      onNotice?.({ kind: 'error', text: message })
      await refresh('soft').catch(() => {})
    } finally {
      setBusy('idle')
    }
  }

  const onDisconnect = async () => {
    setBusy('disconnect')
    setError(null)
    try {
      applyStatus(await api.disconnect())
      onNotice?.({ kind: 'success', text: productText('钉钉已解绑') })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      onNotice?.({ kind: 'error', text: message })
    } finally {
      setBusy('idle')
    }
  }

  const ready = status?.authed === true && status.skillInstalled === true
  const tryPrompt = (prompt: string) => {
    onTry?.(prompt)
  }

  return (
    <div className="dsh-connector-dingtalk">
      <div className="dsh-connector-dingtalk-brand" aria-hidden="true">
        <span className="dsh-connector-dingtalk-brand-wanwei">{productText('WB')}</span>
        <span className="dsh-connector-dingtalk-brand-dots">···</span>
        <img src="/connector-icons/dingtalk.png" alt="" width={40} height={40} />
      </div>
      <p className="dsh-connector-dingtalk-desc">
        {productText('通过命令行管理钉钉全产品能力：AI 表格、考勤、日历、群聊与机器人、通讯录、开放平台文档、DING 消息、钉钉文档、钉钉云盘、AI 听记、邮箱、OA 审批、日志、待办。')}
      </p>
      {busy === 'login' && (
        <p className="dsh-connector-dingtalk-hint">
          {productText('请在弹出的浏览器中完成钉钉扫码或头像授权，完成后返回此窗口。')}
        </p>
      )}
      {error !== null && <p className="dsh-connector-dingtalk-error" role="alert">{error}</p>}
      <div className="dsh-connector-dingtalk-actions">
        {ready ? (
          <>
            <button
              type="button"
              disabled={busy === 'login' || busy === 'disconnect'}
              onClick={() => tryPrompt(DINGTALK_EXAMPLE_PROMPTS[1])}
            >
              {productText('去试试')}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy === 'login' || busy === 'disconnect'}
              onClick={() => { void onDisconnect() }}
            >
              {busy === 'disconnect' ? productText('正在断开…') : productText('解绑')}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy === 'load' || busy === 'login' || busy === 'disconnect' || status?.dwsInstalled !== true}
            onClick={() => { void onConnect() }}
          >
            {busy === 'login' ? productText('等待授权…') : productText('连接')}
          </button>
        )}
      </div>
      <section className="dsh-connector-dingtalk-examples" aria-label={productText('试试这样用')}>
        <h3>{productText('试试这样用')}</h3>
        <ul>
          {DINGTALK_EXAMPLE_PROMPTS.map(key => (
            <li key={key}>
              <button
                type="button"
                className="dsh-connector-dingtalk-example"
                disabled={!ready || busy === 'login' || busy === 'disconnect'}
                onClick={() => tryPrompt(productText(key))}
              >
                <span>{productText('“')}{productText(key)}{productText('”')}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
