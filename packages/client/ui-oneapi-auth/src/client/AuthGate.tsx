import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AuthState } from '../contract.ts'
import css from './AuthGate.module.css'

declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>
      }
    }
  }
}

export interface AuthInjected {
  status: (signal?: AbortSignal) => Promise<AuthState>
  login: (username: string, password: string, signal?: AbortSignal) => Promise<AuthState>
  logout: () => Promise<AuthState>
  subscribe: (listener: (state: AuthState) => void) => () => void
}

/** Props supplied by the slot framework and this plugin's injection face. */
export type AuthGateProps = PropsRuntime<'shell.overlay'> & AuthInjected

type LoginMode = 'account' | 'sms' | 'qr'

function syncNativeWindowState(authenticated: boolean): void {
  const invoke = window.__TAURI__?.core?.invoke
  if (typeof invoke !== 'function') return
  void invoke('set_auth_window_state', { authenticated }).catch((cause: unknown) => {
    console.warn('Unable to update the native window state.', cause)
  })
}

/** Full-window desktop sign-in gate. */
export function AuthGate({ status, login, subscribe }: AuthGateProps) {
  const [auth, setAuth] = useState<AuthState | { state: 'checking' }>({ state: 'checking' })
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [loginMode, setLoginMode] = useState<LoginMode>('account')
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [smsSent, setSmsSent] = useState(false)
  const [qrNonce, setQrNonce] = useState(0)
  const pageRef = useRef<HTMLElement | null>(null)
  const brandSideRef = useRef<HTMLElement | null>(null)
  const brandHeaderRef = useRef<HTMLDivElement | null>(null)
  const brandHeroRef = useRef<HTMLDivElement | null>(null)
  const featureListRef = useRef<HTMLDivElement | null>(null)
  const capabilityRef = useRef<HTMLDivElement | null>(null)
  const footerRef = useRef<HTMLParagraphElement | null>(null)
  const formCardRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if ('username' in auth && typeof auth.username === 'string') setUsername(auth.username)
  }, [auth])

  useEffect(() => {
    const controller = new AbortController()
    void status(controller.signal).then((next) => {
      setAuth(next)
      syncNativeWindowState(next.state === 'authenticated')
    }, (cause: unknown) => {
      if (!controller.signal.aborted) {
        const next = { state: 'offline' as const, message: cause instanceof Error ? cause.message : String(cause) }
        setAuth(next)
        syncNativeWindowState(false)
      }
    })
    return () => { controller.abort() }
  }, [status])

  useEffect(() => subscribe((next) => {
    setAuth(next)
    syncNativeWindowState(next.state === 'authenticated')
  }), [subscribe])

  // The login gate starts with a fixed native window. Once authentication is
  // complete, the Tauri shell enables resizing/maximizing for the main app.
  useEffect(() => {
    const authenticated = auth.state === 'authenticated'
    syncNativeWindowState(authenticated)
    const retry = window.setTimeout(() => { syncNativeWindowState(authenticated) }, 180)
    return () => { window.clearTimeout(retry) }
  }, [auth.state])

  // Keep the capability panel aligned with the login card on desktop sizes.
  // The footer is deliberately placed slightly below the panel so it never
  // overlaps the panel content. On narrow screens the normal document flow is
  // restored to keep the page scrollable and responsive.
  useLayoutEffect(() => {
    const page = pageRef.current
    const side = brandSideRef.current
    const hero = brandHeroRef.current
    const featureList = featureListRef.current
    const header = brandHeaderRef.current
    const logo = side?.querySelector<HTMLElement>('[class*="fullLogo"]')
    const capability = capabilityRef.current
    const footer = footerRef.current
    const card = formCardRef.current
    if (!page || !side || !header || !hero || !featureList || !logo || !capability || !footer || !card) return

    const desktop = () => window.matchMedia('(min-width: 961px)').matches
    const updateScale = () => {
      if (!desktop()) {
        page.style.setProperty('--login-scale', '1')
        page.style.removeProperty('--login-layout-width')
        page.style.removeProperty('--login-layout-height')
        return 1
      }

      const scale = Math.min(window.innerWidth / 1120, window.innerHeight / 720)
      const boundedScale = Math.max(0.82, Math.min(scale, 1.4))
      page.style.setProperty('--login-scale', boundedScale.toFixed(4))
      page.style.setProperty('--login-layout-width', `${window.innerWidth / boundedScale}px`)
      page.style.setProperty('--login-layout-height', `${window.innerHeight / boundedScale}px`)
      return boundedScale
    }

    const clearInlineLayout = () => {
      page.style.removeProperty('--login-scale')
      page.style.removeProperty('--login-layout-width')
      page.style.removeProperty('--login-layout-height')
      side.style.removeProperty('position')
      side.style.removeProperty('align-self')
      header.style.removeProperty('position')
      header.style.removeProperty('left')
      header.style.removeProperty('top')
      header.style.removeProperty('z-index')
      hero.style.removeProperty('position')
      hero.style.removeProperty('left')
      hero.style.removeProperty('top')
      hero.style.removeProperty('margin')
      hero.style.removeProperty('transform')
      featureList.style.removeProperty('position')
      featureList.style.removeProperty('left')
      featureList.style.removeProperty('top')
      featureList.style.removeProperty('margin')
      featureList.style.removeProperty('transform')
      capability.style.removeProperty('position')
      capability.style.removeProperty('left')
      capability.style.removeProperty('right')
      capability.style.removeProperty('bottom')
      capability.style.removeProperty('margin')
      footer.style.removeProperty('position')
      footer.style.removeProperty('left')
      footer.style.removeProperty('bottom')
      footer.style.removeProperty('margin')
      footer.style.removeProperty('z-index')
    }

    const update = () => {
      if (!desktop()) {
        clearInlineLayout()
        return
      }

      const scale = updateScale()
      side.style.position = 'relative'
      side.style.alignSelf = 'stretch'

      logo.style.width = '250px'
      logo.style.height = '83px'
      logo.style.margin = '0'
      header.style.position = 'absolute'
      header.style.left = '20px'
      header.style.top = '20px'
      header.style.zIndex = '1'

      const heroTop = logo.getBoundingClientRect().bottom - side.getBoundingClientRect().top + 28
      hero.style.position = 'absolute'
      hero.style.left = '20px'
      hero.style.top = `${heroTop}px`
      hero.style.margin = '0'
      hero.style.transform = 'none'

      featureList.style.position = 'absolute'
      featureList.style.left = '20px'
      featureList.style.top = `${heroTop + hero.offsetHeight + 24}px`
      featureList.style.margin = '0'
      featureList.style.transform = 'translateY(14px)'

      const sideRect = side.getBoundingClientRect()
      const cardRect = card.getBoundingClientRect()
      const bottomOffset = Math.max(20, (sideRect.bottom - cardRect.bottom) / scale)

      capability.style.position = 'absolute'
      capability.style.left = '0px'
      capability.style.right = '0px'
      capability.style.bottom = `${bottomOffset}px`
      capability.style.margin = '0'

      footer.style.position = 'absolute'
      footer.style.left = '0px'
      footer.style.bottom = '-16px'
      footer.style.margin = '0'
      footer.style.zIndex = '5'
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(side)
    observer.observe(card)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      clearInlineLayout()
    }
  }, [])

  if (auth.state === 'authenticated') {
    return null
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const next = await login(username, password)
      setAuth(next)
      syncNativeWindowState(next.state === 'authenticated')
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

      <main ref={pageRef} className={css.page} aria-label="登录 ZJUGIS Harness">
        <section ref={brandSideRef} className={css.brandSide} aria-label="产品介绍">
          <div ref={brandHeaderRef} className={css.brandHeader}>
            <span className={css.logoText}>
              <img
                className={css.fullLogo}
                src="/zjugis-harness.png"
                width={250}
                height={83}
                alt="ZJUGIS Harness"
              />
            </span>
          </div>

          <div ref={brandHeroRef} className={css.brandHero}>
            <h1>桌面级智能体<br /><span>让工作更高效</span></h1>
            <p>面向组织办公场景打造的桌面智能助手，支持知识问答、本地文档处理、任务协作与流程执行，可按不同环境灵活部署，数据流向清晰可控。</p>
          </div>

          <div ref={featureListRef} className={css.featureList} aria-label="核心能力">
            <div className={css.featurePill}><FileIcon />本地文件处理</div>
            <div className={css.featurePill}><SearchIcon />知识问答</div>
            <div className={css.featurePill}><FlowIcon />任务协作</div>
            <div className={css.featurePill}><ServerIcon />灵活部署</div>
          </div>

          <div ref={capabilityRef} className={css.capabilityCard}>
            <h2><span className={css.sectionDot} />智能体能力</h2>
            <div className={css.capabilityGrid}>
              <Capability icon={<SearchIcon />} title="知识问答" detail="快速检索制度、规范与业务资料，辅助定位关键信息" />
              <Capability icon={<FileIcon />} title="文档智能处理" detail="读取、整理、分析和修改本地办公文件" />
              <Capability icon={<FlowIcon />} title="任务流程协作" detail="拆解复杂任务、调用工具，持续跟踪执行结果" />
              <Capability icon={<ServerIcon />} title="可控环境部署" detail="支持内网或专用环境部署，模型与数据按需配置" />
            </div>
          </div>

          <p ref={footerRef} className={css.pageFooter}>© 2026 ZJUGIS · 智能体工作平台</p>
        </section>

        <section className={css.formSide} aria-label="账号登录">
          <div ref={formCardRef} className={css.card}>
            <div className={css.cardHeader}>
              <h2>登录智能体</h2>
              <p>开启你的桌面智能助手</p>
            </div>
            <div className={css.loginMode} role="tablist" aria-label="登录方式">
              {(['account', 'sms', 'qr'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  className={loginMode === mode ? css.loginModeActive : undefined}
                  role="tab"
                  aria-selected={loginMode === mode}
                  onClick={() => { setLoginMode(mode); setError(undefined) }}
                >
                  {mode === 'account' ? '账号登录' : mode === 'sms' ? '短信登录' : '扫码登录'}
                </button>
              ))}
            </div>
            {auth.state === 'checking'
              ? <p className={css.status}>正在检查登录状态…</p>
              : loginMode === 'account' ? (
                <form onSubmit={(event) => { void submit(event) }}>
                  <label>账号<input autoFocus autoComplete="username" value={username} onChange={(event) => { setUsername(event.target.value) }} placeholder="请输入单位账号或用户名" required /></label>
                  <label>密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => { setPassword(event.target.value) }} placeholder="请输入密码" required /></label>
                  <div className={css.formOptions}>
                    <label className={css.remember}><input type="checkbox" /> <span>记住我</span></label>
                    <a href="#password-reset">忘记密码?</a>
                  </div>
                  {(error ?? (auth.state === 'offline' ? '暂时无法连接服务，请检查网络后重试。' : undefined)) !== undefined
                    && <p className={css.error} role="alert">{error ?? '暂时无法连接服务，请检查网络后重试。'}</p>}
                  <button type="submit" disabled={busy || username.trim() === '' || password === ''}>
                    {busy ? '正在登录…' : '登录'}
                  </button>
                </form>
              ) : loginMode === 'sms' ? (
                <form className={css.mockForm} onSubmit={(event) => { event.preventDefault(); setError('短信登录为 Mock 演示，暂未接入真实短信服务') }}>
                  <label>手机号<input type="tel" autoComplete="tel" value={phone} onChange={(event) => { setPhone(event.target.value); setSmsSent(false) }} placeholder="请输入手机号" /></label>
                  <div className={css.smsCodeRow}>
                    <label>验证码<input inputMode="numeric" value={smsCode} onChange={(event) => { setSmsCode(event.target.value) }} placeholder="请输入验证码" /></label>
                    <button className={css.smsCodeButton} type="button" disabled={phone.trim() === ''} onClick={() => { setSmsSent(true) }}>{smsSent ? '已发送（Mock）' : '获取验证码'}</button>
                  </div>
                  {error && <p className={css.error} role="alert">{error}</p>}
                  <p className={css.mockNotice}>短信登录为演示入口，暂未接入真实短信服务。</p>
                  <button type="submit">登录</button>
                </form>
              ) : (
                <div className={css.qrPanel}>
                  <div className={css.qrMock} key={qrNonce} aria-label="二维码">
                    {Array.from({ length: 169 }, (_, index) => {
                      const x = index % 13
                      const y = Math.floor(index / 13)
                      const finder = (ox: number, oy: number) => {
                        const inSquare = x >= ox && x < ox + 5 && y >= oy && y < oy + 5
                        const border = x === ox || x === ox + 4 || y === oy || y === oy + 4
                        const center = x >= ox + 1 && x <= ox + 3 && y >= oy + 1 && y <= oy + 3
                        return inSquare && (border || center)
                      }
                      const dark = finder(0, 0) || finder(8, 0) || finder(0, 8) || ((x * 17 + y * 11 + qrNonce * 7) % 7 < 3)
                      return <span key={`${qrNonce}-${index}`} className={dark ? css.qrDark : undefined} />
                    })}
                  </div>
                  <strong>扫码登录</strong>
                  <p>使用手机扫描二维码登录</p>
                  <button type="button" onClick={() => { setQrNonce(value => value + 1) }}>刷新二维码</button>
                </div>
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
  return (
    <div className={css.capabilityItem}>
      <span className={css.capabilityIcon}>{icon}</span>
      <span><strong>{title}</strong><small>{detail}</small></span>
    </div>
  )
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
