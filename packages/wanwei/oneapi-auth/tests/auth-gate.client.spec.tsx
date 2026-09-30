// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { AuthView } from '../src/client/controller.ts'
import { AuthGate, type AuthGateProps } from '../src/client/AuthGate.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: true })),
  })
})

const t: Parameters<typeof AuthGate>[0]['t'] = makeTranslate(zh, commonZh)
const unusedHook = (() => { throw new Error('unused by AuthGate') }) as never
type AttentionSnapshot = Parameters<Parameters<AuthGateProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: AuthGateProps['useSessionPendingInteraction'] = selector => selector(noAttention)
const kit = {
  useNetwork: ((selector: (value: { mode: 'internet'; internalOrigins: string[] }) => unknown) => selector({ mode: 'internet', internalOrigins: [] })) as AuthGateProps['useNetwork'],
  setNetworkEnvironment: vi.fn(async (mode: 'internet' | 'intranet') => ({ mode, internalOrigins: [] })),
  useSessions: unusedHook,
  useSessionPendingInteraction,
  useWorkspaces: unusedHook,
}

function renderGate(view: AuthView = { state: 'logged-out' }) {
  const login = vi.fn(() => Promise.resolve({ state: 'authenticated' as const, username: 'wanwei', models: ['qwen'] }))
  const refresh = vi.fn(() => Promise.resolve({ state: 'logged-out' as const }))
  const fail = vi.fn()
  const useAuth = <Selected,>(selector: (state: AuthView) => Selected): Selected => selector(view)
  render(<AuthGate {...kit} useAuth={useAuth} login={login} refresh={refresh} fail={fail} t={t} />)
  return { login, refresh, fail }
}

describe('Wanwei authentication gate', () => {
  it('renders the production product lockup with the purple account-login surface', async () => {
    const subject = renderGate()
    expect(screen.getByAltText(zh.productName)).toBeTruthy()
    expect(screen.getByText(zh.heroTitle)).toBeTruthy()
    expect(screen.getByText(zh.agentCapabilities)).toBeTruthy()
    expect(screen.getByText(zh.documentProcessing)).toBeTruthy()
    expect(screen.getByRole('tab', { name: zh.accountLogin }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('button', { name: zh.signIn })).toHaveProperty('disabled', true)
    await waitFor(() => { expect(subject.refresh).toHaveBeenCalledOnce() })
  })

  it('keeps the production SMS and QR demonstration entry points visible without authenticating', async () => {
    renderGate()
    fireEvent.click(screen.getByRole('tab', { name: zh.smsLogin }))
    expect(screen.getByPlaceholderText(zh.phonePlaceholder)).toBeTruthy()
    expect(screen.getByText(zh.smsMockNotice)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: zh.qrLogin }))
    expect(screen.getByLabelText(zh.qrCodeLabel)).toBeTruthy()
    expect(screen.getByText(zh.qrInstruction)).toBeTruthy()
  })

  it('submits credentials only through the live account login action', async () => {
    const subject = renderGate()
    fireEvent.change(screen.getByLabelText(zh.username), { target: { value: 'wanwei' } })
    fireEvent.change(screen.getByLabelText(zh.password), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: zh.signIn }))
    await waitFor(() => { expect(subject.login).toHaveBeenCalledWith('wanwei', 'secret') })
  })

  it('notifies product-owned expert views when login state changes', () => {
    const listener = vi.fn()
    window.addEventListener('wanwei:auth-state', listener)
    renderGate({ state: 'logged-out' })
    expect((listener.mock.lastCall?.[0] as CustomEvent<{ authenticated: boolean }>).detail.authenticated).toBe(false)
    cleanup()
    renderGate({ state: 'authenticated', username: 'wanwei', models: [] })
    expect((listener.mock.lastCall?.[0] as CustomEvent<{ authenticated: boolean }>).detail.authenticated).toBe(true)
    window.removeEventListener('wanwei:auth-state', listener)
  })

  it('keeps the same form mounted while the initial authentication check settles', () => {
    let view: AuthView = { state: 'checking' }
    const useAuth: AuthGateProps['useAuth'] = selector => selector(view)
    const refresh = vi.fn(() => Promise.resolve({ state: 'logged-out' as const }))
    const login = vi.fn()
    const fail = vi.fn()
    const element = () => <AuthGate {...kit} useAuth={useAuth} refresh={refresh} login={login} fail={fail} t={t} />
    const subject = render(element())
    const account = screen.getByLabelText(zh.username)
    const card = screen.getByRole('heading', { name: zh.loginTitle }).parentElement?.parentElement
    expect(account).toHaveProperty('disabled', false)
    expect(screen.getByLabelText(zh.password)).toHaveProperty('disabled', false)
    fireEvent.change(account, { target: { value: 'draft-account' } })
    fireEvent.change(screen.getByLabelText(zh.password), { target: { value: 'draft-password' } })
    expect(screen.getByRole('button', { name: zh.checking })).toHaveProperty('disabled', true)

    view = { state: 'logged-out' }
    subject.rerender(element())
    expect(screen.getByLabelText(zh.username)).toBe(account)
    expect(account).toHaveProperty('disabled', false)
    expect(account).toHaveProperty('value', 'draft-account')
    expect(screen.getByLabelText(zh.password)).toHaveProperty('value', 'draft-password')
    expect(screen.getByRole('heading', { name: zh.loginTitle }).parentElement?.parentElement).toBe(card)
  })

  it('rebinds layout scaling to the new login page after leaving the workspace', () => {
    let view: AuthView = { state: 'logged-out' }
    const useAuth: AuthGateProps['useAuth'] = selector => selector(view)
    const refresh = vi.fn(() => Promise.resolve({ state: 'logged-out' as const }))
    const login = vi.fn()
    const fail = vi.fn()
    const element = () => <AuthGate {...kit} useAuth={useAuth} refresh={refresh} login={login} fail={fail} t={t} />
    const subject = render(element())
    const initialStyle = screen.getByRole('main').getAttribute('style')
    expect(initialStyle).toContain('--login-scale')
    fireEvent.click(screen.getByRole('tab', { name: zh.smsLogin }))

    view = { state: 'authenticated', username: 'wanwei', models: [] }
    subject.rerender(element())
    expect(screen.queryByRole('main')).toBeNull()
    view = { state: 'logged-out' }
    subject.rerender(element())
    const page = screen.getByRole('main')
    expect(page.getAttribute('style')).toBe(initialStyle)
    expect(screen.getByRole('tab', { name: zh.accountLogin }).getAttribute('aria-selected')).toBe('true')

    const scale = page.style.getPropertyValue('--login-scale')
    page.style.removeProperty('--login-scale')
    fireEvent(window, new Event('resize'))
    expect(page.style.getPropertyValue('--login-scale')).toBe(scale)
  })

  it('keeps a fixed desktop canvas when native titlebars change the available height', () => {
    const originalWidth = window.innerWidth
    const originalHeight = window.innerHeight
    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1120 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 697 })
      renderGate()
      const page = screen.getByRole('main')
      expect(page.style.getPropertyValue('--login-layout-width')).toBe('1120px')
      expect(page.style.getPropertyValue('--login-layout-height')).toBe('720px')
      expect(page.style.getPropertyValue('--login-scale')).toBe('0.9681')
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 })
      fireEvent(window, new Event('resize'))
      expect(page.style.getPropertyValue('--login-scale')).toBe('1.0000')
      expect(page.style.getPropertyValue('--login-layout-width')).toBe('1120px')
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight })
    }
  })
})
