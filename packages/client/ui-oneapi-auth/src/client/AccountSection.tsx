import { useEffect, useState } from 'react'
import type { PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { AuthState } from '../contract.ts'
import type { AuthInjected } from './AuthGate.tsx'
import css from './AccountSection.module.css'

export type AccountSectionProps = PropsRuntime<'settings.section'> & InjectFace<AuthInjected>

/** Account information and the server-session logout action. */
export function AccountSection({ status, logout, subscribe }: AccountSectionProps) {
  const [auth, setAuth] = useState<AuthState | { state: 'checking' }>({ state: 'checking' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    void status(controller.signal).then(setAuth, (cause: unknown) => {
      if (!controller.signal.aborted) setAuth({ state: 'offline', message: cause instanceof Error ? cause.message : String(cause) })
    })
    return () => { controller.abort() }
  }, [status])
  useEffect(() => subscribe(setAuth), [subscribe])

  const onLogout = () => { void (async () => {
    setBusy(true)
    setError(undefined)
    try { setAuth(await logout()) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  })() }

  return (
    <section className={css.section}>
      <h1>账户设置</h1>
      <p className={css.hint}>管理当前桌面端连接的服务器账号。</p>
      <div className={css.card}>
        <div>
          <div className={css.label}>登录账号</div>
          <div className={css.value}>
            {auth.state === 'checking' ? '正在检查登录状态…'
              : auth.state === 'authenticated' ? (auth.username ?? '已登录')
              : auth.state === 'logged-out' ? '未登录'
              : `暂时无法连接：${auth.message}`}
          </div>
        </div>
        {auth.state === 'authenticated' && (
          <button type="button" className={css.logout} disabled={busy} onClick={onLogout}>
            {busy ? '正在退出…' : '退出登录'}
          </button>
        )}
      </div>
      {error !== undefined && <p className={css.error} role="alert">{error}</p>}
    </section>
  )
}
