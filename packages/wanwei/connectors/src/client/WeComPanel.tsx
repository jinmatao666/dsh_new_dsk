import { useEffect, useState } from 'react'
import { waitForConnectorAuthorization } from './authorize-wait.ts'
import { getCachedWeComStatus, setCachedWeComStatus } from './wecom-status-cache.ts'
import { productText } from './locales/product.ts'

/** Non-secret wecom-cli + skill status from Host. */
export type WeComStatus = {
  cliInstalled: boolean
  cliVersion: string | null
  authed: boolean
  skillInstalled: boolean
  hint: string | null
  /** True while the Host login process is still running after the RPC returned. */
  authorizing?: boolean
  /** CLI failure from that background login, or null. */
  authorizeError?: string | null
}

/** Host RPC face for desktop WeCom skill connection. */
export type WeComApi = {
  status: () => Promise<WeComStatus>
  login: () => Promise<WeComStatus>
  installSkill: () => Promise<WeComStatus>
  disconnect: () => Promise<WeComStatus>
}

/** Example prompts shown under 试试这样用 (WorkBuddy-compatible). */
export const WECOM_EXAMPLE_PROMPTS = [
  '帮我整理下最新一周AI资讯，通过企业微信消息发送给我自己',
  '根据最近一周我与客户沟通的企业微信邮件和会议，生成给客户的演示文稿',
  '根据产品文档内容，生成一份总结摘要的PDF，文档链接是 https://doc.weixin.qq.com/XXXXXX',
  '读取表格数据进行分析，提炼需要我关注的要点，表格链接是 https://doc.weixin.qq.com/XXXXXX',
] as const

/**
 * WorkBuddy-style WeCom connect sheet: 连接 → browser QR → 去试试 / 解绑.
 * @param props.api - Host RPC callbacks.
 * @param props.onTry - Stage a prompt in desktop chat and leave the connectors page.
 * @param props.initialStatus - Last-known status for instant paint while a soft refresh runs.
 * @param props.onNotice - Transient success/error feedback after connect or unbind.
 */
export function WeComPanel({
  api,
  onTry,
  initialStatus,
  onNotice,
}: {
  api: WeComApi
  onTry?: (prompt: string) => void
  initialStatus?: WeComStatus | null
  onNotice?: (notice: { kind: 'success' | 'error' | 'info'; text: string }) => void
}) {
  const seed = initialStatus ?? getCachedWeComStatus()
  const [status, setStatus] = useState<WeComStatus | null>(seed)
  const [busy, setBusy] = useState<'idle' | 'load' | 'login' | 'disconnect'>(seed !== null ? 'idle' : 'load')
  const [error, setError] = useState<string | null>(null)

  const applyStatus = (next: WeComStatus) => {
    setCachedWeComStatus(next)
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
   * Single「连接」action: Host runs `wecom-cli auth init --noninteractive`
   * (browser QR), then installs skills. Matches WorkBuddy (no separate「启用技能」).
   */
  const onConnect = async () => {
    setBusy('login')
    setError(null)
    try {
      // Always go through Host `login`: browser QR when unauthenticated; skill
      // copy only when CLI auth is already present (Host short-circuits auth init).
      const started = await api.login()
      applyStatus(started)
      const next = started.authorizing === true
        ? await waitForConnectorAuthorization(() => api.status())
        : started
      applyStatus(next)
      if (next.authed && next.skillInstalled) {
        onNotice?.({ kind: 'success', text: productText('企业微信已连接') })
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
      onNotice?.({ kind: 'success', text: productText('企业微信已解绑') })
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
        <img src="/connector-icons/wecom.png" alt="" width={40} height={40} />
      </div>
      <p className="dsh-connector-dingtalk-desc">
        {productText('企业微信官方 CLI 套件，覆盖消息、邮件、文档、待办、日程、会议、微盘、通讯录等业务功能。支持机器人主动通知、新建与读取文档、文档搜索、新建管理日程、预约与获取会议信息、新建跟进待办、上传与获取微盘文件、邮件读取与发送等能力')}
      </p>
      {busy === 'login' && (
        <p className="dsh-connector-dingtalk-hint">
          {productText('请在弹出的浏览器中用企业微信扫码接入智能机器人，完成后返回此窗口。')}
        </p>
      )}
      {error !== null && <p className="dsh-connector-dingtalk-error" role="alert">{error}</p>}
      <div className="dsh-connector-dingtalk-actions">
        {ready ? (
          <>
            <button
              type="button"
              disabled={busy === 'login' || busy === 'disconnect'}
              onClick={() => tryPrompt(WECOM_EXAMPLE_PROMPTS[1])}
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
            disabled={busy === 'load' || busy === 'login' || busy === 'disconnect' || status?.cliInstalled !== true}
            onClick={() => { void onConnect() }}
          >
            {busy === 'login' ? productText('等待授权…') : productText('连接')}
          </button>
        )}
      </div>
      <section className="dsh-connector-dingtalk-examples" aria-label={productText('试试这样用')}>
        <h3>{productText('试试这样用')}</h3>
        <ul>
          {WECOM_EXAMPLE_PROMPTS.map(key => (
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
