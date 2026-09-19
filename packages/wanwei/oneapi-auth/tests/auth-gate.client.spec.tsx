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
})
