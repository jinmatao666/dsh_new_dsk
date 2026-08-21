import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AuthState } from '../contract.ts'
import css from './AuthGate.module.css'

export interface AuthInjected {
  status: (signal?: AbortSignal) => Promise<AuthState>
  login: (username: string, password: string, signal?: AbortSignal) => Promise<AuthState>
  logout: () => Promise<AuthState>
  subscribe: (listener: (state: AuthState) => void) => () => void
}

/** Props supplied by the slot framework and this plugin's injection face. */
export type AuthGateProps = PropsRuntime<'shell.overlay'> & AuthInjected

/** Full-window desktop sign-in gate. */
export function AuthGate({ status, login, subscribe }: AuthGateProps) {
  const [auth, setAuth] = useState<AuthState | { state: 'checking' }>({ state: 'checking' })
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if ('username' in auth && typeof auth.username === 'string') setUsername(auth.username)
  }, [auth])

  useEffect(() => {
    const controller = new AbortController()
    void status(controller.signal).then(setAuth, (cause: unknown) => {
      if (!controller.signal.aborted) setAuth({ state: 'offline', message: cause instanceof Error ? cause.message : String(cause) })
    })
    return () => { controller.abort() }
  }, [status])

  useEffect(() => subscribe(setAuth), [subscribe])

  if (auth.state === 'authenticated') {
    return null
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      setAuth(await login(username, password))
      setPassword('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.backdrop}>
      <main className={css.card} aria-label="登录 DSH Desktop">
        <img className={css.mark} src="/wanwei-mark.png" alt="" aria-hidden="true" />
        <h1>登录 Wanwei Harness</h1>
        <p className={css.lead}>使用服务器账号登录，模型访问凭据将安全保存在本机。</p>
        {auth.state === 'checking'
          ? <p className={css.status}>正在检查登录状态…</p>
          : (
            <form onSubmit={(event) => { void submit(event) }}>
              <label>用户名<input autoFocus autoComplete="username" value={username} onChange={(event) => { setUsername(event.target.value) }} /></label>
              <label>密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => { setPassword(event.target.value) }} /></label>
              {(error ?? (auth.state === 'offline' ? auth.message : undefined)) !== undefined
                && <p className={css.error} role="alert">{error ?? (auth.state === 'offline' ? auth.message : '')}</p>}
              <button type="submit" disabled={busy || username.trim() === '' || password === ''}>
                {busy ? '正在登录…' : '登录'}
              </button>
            </form>
          )}
        <p className={css.foot}>文件处理直接在本机 DSH Sidecar 中完成，不上传工作目录。</p>
      </main>
    </div>
  )
}
