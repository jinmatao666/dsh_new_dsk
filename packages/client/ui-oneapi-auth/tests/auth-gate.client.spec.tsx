// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthState } from '../src/contract.ts'
import { AuthGate, type AuthGateProps } from '../src/client/AuthGate.tsx'

let authListener: ((state: AuthState) => void) | undefined

beforeEach(() => {
  authListener = undefined
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  })
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true }) as MediaQueryList))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function props(): AuthGateProps {
  return {
    status: async () => ({ state: 'authenticated', models: [] }),
    login: async () => ({ state: 'authenticated', models: [] }),
    logout: async () => ({ state: 'logged-out' }),
    subscribe: (listener) => {
      authListener = listener
      return () => { authListener = undefined }
    },
  } as AuthGateProps
}

describe('AuthGate layout', () => {
  it('reapplies the desktop layout after an authenticated session logs out', async () => {
    const view = render(<AuthGate {...props()} />)
    await waitFor(() => { expect(view.queryByLabelText('登录 ZJUGIS Harness')).toBeNull() })

    act(() => { authListener?.({ state: 'logged-out' }) })

    const heading = await view.findByRole('heading', { name: /桌面级智能体/u })
    const hero = heading.parentElement
    expect(hero?.style.position).toBe('absolute')
    expect(hero?.style.left).toBe('20px')
  })
})
