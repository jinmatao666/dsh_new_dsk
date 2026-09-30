// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { AccountSection, type AccountSectionProps } from '../src/client/AccountSection.tsx'
import type { AuthState } from '../src/contract.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: AccountSectionProps['t'] = makeTranslate(zh, commonZh)
const unusedHook = (() => { throw new Error('unused by AccountSection') }) as never
const kit = {
  useSessions: unusedHook,
  useSessionPendingInteraction: unusedHook,
  useWorkspaces: unusedHook,
}
const useAuth: AccountSectionProps['useAuth'] = selector => selector({
  state: 'authenticated', username: 'wanwei', models: [],
})

describe('Account settings logout', () => {
  it('keeps settings open while signing out and closes after logout succeeds', async () => {
    let finish!: (state: AuthState) => void
    const logout = vi.fn(() => new Promise<AuthState>((resolve) => { finish = resolve }))
    const close = vi.fn()
    render(<AccountSection {...kit} useAuth={useAuth} logout={logout} close={close} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: zh.signOut }))
    expect(logout).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
    finish({ state: 'logged-out' })
    await waitFor(() => { expect(close).toHaveBeenCalledOnce() })
  })

  it('retains settings and shows the error when logout fails', async () => {
    const logout = vi.fn(() => Promise.reject(new Error('Logout unavailable')))
    const close = vi.fn()
    render(<AccountSection {...kit} useAuth={useAuth} logout={logout} close={close} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: zh.signOut }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('Logout unavailable') })
    expect(close).not.toHaveBeenCalled()
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false)
  })
})
