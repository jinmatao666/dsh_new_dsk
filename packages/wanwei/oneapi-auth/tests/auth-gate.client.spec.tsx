// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AuthView } from '../src/client/controller.ts'
import { AuthGate } from '../src/client/AuthGate.tsx'
import { zh, type WanweiAuthKey } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: true })),
  })
})

const t = (key: WanweiAuthKey): string => zh[key]

function renderGate(view: AuthView = { state: 'logged-out' }) {
  const login = vi.fn(() => Promise.resolve({ state: 'authenticated' as const, username: 'wanwei', models: ['qwen'] }))
  const refresh = vi.fn(() => Promise.resolve({ state: 'logged-out' as const }))
  const fail = vi.fn()
  const useAuth = <Selected,>(selector: (state: AuthView) => Selected): Selected => selector(view)
  render(<AuthGate useAuth={useAuth} login={login} refresh={refresh} fail={fail} t={t} />)
  return { login, refresh, fail }
}

describe('Wanwei authentication gate', () => {
  it('renders the complete purple-preview product and account-login surface', async () => {
    const subject = renderGate()
    expect(screen.getByText(zh.productName)).toBeTruthy()
    expect(screen.getByText(zh.previewBadge)).toBeTruthy()
    expect(screen.getByText(zh.heroTitle)).toBeTruthy()
    expect(screen.getByText(zh.agentCapabilities)).toBeTruthy()
    expect(screen.getByText(zh.documentProcessing)).toBeTruthy()
    expect(screen.getByRole('tab', { name: zh.accountLogin }).getAttribute('aria-selected')).toBe('true')
    expect((screen.getByRole('button', { name: zh.signIn }) as HTMLButtonElement).disabled).toBe(true)
    await waitFor(() => { expect(subject.refresh).toHaveBeenCalledOnce() })
  })

  it('keeps unconfigured SMS and QR entry points visible without simulating authentication', async () => {
    renderGate()
    fireEvent.click(screen.getByRole('tab', { name: zh.smsLogin }))
    expect(screen.getByText(zh.smsUnavailableTitle)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: zh.qrLogin }))
    expect(screen.getByText(zh.qrUnavailableTitle)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.useAccountLogin }))
    expect(screen.getByLabelText(zh.username)).toBeTruthy()
  })

  it('submits credentials only through the live account login action', async () => {
    const subject = renderGate()
    fireEvent.change(screen.getByLabelText(zh.username), { target: { value: 'wanwei' } })
    fireEvent.change(screen.getByLabelText(zh.password), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: zh.signIn }))
    await waitFor(() => { expect(subject.login).toHaveBeenCalledWith('wanwei', 'secret') })
  })
})
