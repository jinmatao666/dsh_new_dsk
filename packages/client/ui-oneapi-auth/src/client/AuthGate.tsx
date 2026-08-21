import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
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
      <div className={css.decoBlobOne} aria-hidden="true" />
      <div className={css.decoBlobTwo} aria-hidden="true" />
      <div className={css.decoBlobThree} aria-hidden="true" />

      <main className={css.page} aria-label="登录 Wanwei Harness">
        <section className={css.brandSide} aria-label="产品介绍">
          <div className={css.brandHeader}>
            <span className={css.logoWrap}>
              <img src="/wanwei-mark.png" alt="" aria-hidden="true" />
            </span>
            <span className={css.logoText}>
              <img className={css.wordmark} src="/wanwei-wordmark.png" alt="Wanwei" />
              <img className={css.harnessMark} src="/wanwei-harness.png" alt="Harness" />
            </span>
          </div>

          <div className={css.brandHero}>
            <h1>桌面级智能体<br /><span>让工作更高效</span></h1>
            <p>面向组织办公场景打造的桌面智能助手，支持知识问答、本地文档处理、任务协作与流程执行，可按不同环境灵活部署，数据流向清晰可控。</p>
          </div>

          <div className={css.featureList} aria-label="核心能力">
            <div className={css.featurePill}><FileIcon />本地文件处理</div>
            <div className={css.featurePill}><SearchIcon />知识问答</div>
            <div className={css.featurePill}><FlowIcon />任务协作</div>
            <div className={css.featurePill}><ServerIcon />灵活部署</div>
          </div>

          <div className={css.capabilityCard}>
            <h2><span className={css.sectionDot} />智能体能力</h2>
            <div className={css.capabilityGrid}>
              <Capability icon={<SearchIcon />} title="知识问答" detail="快速检索制度、规范与业务资料，辅助定位关键信息" />
              <Capability icon={<FileIcon />} title="文档智能处理" detail="读取、整理、分析和修改本地办公文件" />
              <Capability icon={<FlowIcon />} title="任务流程协作" detail="拆解复杂任务、调用工具，持续跟踪执行结果" />
              <Capability icon={<ServerIcon />} title="可控环境部署" detail="支持内网或专用环境部署，模型与数据按需配置" />
            </div>
          </div>

          <p className={css.pageFooter}>© 2026 Wanwei · 智能体工作平台</p>
        </section>

        <section className={css.formSide} aria-label="账号登录">
          <div className={css.card}>
            <div className={css.cardHeader}>
              <h2>登录智能体</h2>
              <p>开启你的桌面智能助手</p>
            </div>
            <div className={css.loginMode} role="tablist" aria-label="登录方式">
              <span className={css.loginModeActive} role="tab" aria-selected="true">账号登录</span>
              <span role="tab" aria-selected="false" aria-disabled="true">短信登录</span>
              <span role="tab" aria-selected="false" aria-disabled="true">扫码登录</span>
            </div>
            {auth.state === 'checking'
              ? <p className={css.status}>正在检查登录状态…</p>
              : (
                <form onSubmit={(event) => { void submit(event) }}>
                  <label>账号<input autoFocus autoComplete="username" value={username} onChange={(event) => { setUsername(event.target.value) }} placeholder="请输入单位账号或用户名" required /></label>
                  <label>密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => { setPassword(event.target.value) }} placeholder="请输入密码" required /></label>
                  <div className={css.formOptions}>
                    <label className={css.remember}><input type="checkbox" /> <span>记住我</span></label>
                    <a href="#password-reset">忘记密码?</a>
                  </div>
                  {(error ?? (auth.state === 'offline' ? auth.message : undefined)) !== undefined
                    && <p className={css.error} role="alert">{error ?? (auth.state === 'offline' ? auth.message : '')}</p>}
                  <button type="submit" disabled={busy || username.trim() === '' || password === ''}>
                    {busy ? '正在登录…' : '登录'}
                  </button>
                </form>
              )}
            <p className={css.legalNotice}>
              登录即表示同意<a href="#user-agreement">用户协议</a>和<a href="#privacy-policy">隐私政策</a><br />
              未注册手机号将自动创建账号并登录，密码可在个人中心后续设置。
            </p>
            <p className={css.formFooter}>还没有账号？<a href="#account-request">申请开通</a></p>
          </div>
        </section>
      </main>
    </div>
  )
}

function Capability({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <div className={css.capabilityItem}><span className={css.capabilityIcon}>{icon}</span><span><strong>{title}</strong><small>{detail}</small></span></div>
}

function FileIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h4" /></svg>
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
}

function FlowIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.5 6H13a5 5 0 0 1 5 5v4.5M15.5 18H11a5 5 0 0 1-5-5V8.5" /></svg>
}

function ServerIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="6" rx="1.5" /><rect x="4" y="14" width="16" height="6" rx="1.5" /><path d="M8 7h.01M8 17h.01" /></svg>
}
