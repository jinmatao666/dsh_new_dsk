// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AccountFooter } from '../src/client/AccountFooter.tsx'
import { zh } from '../src/client/locales.ts'
import type { AuthView } from '../src/client/controller.ts'

afterEach(cleanup)

it('shows the signed-in user and reveals controls without unmounting them', async () => {
  const logout = vi.fn(async () => ({ state: 'logged-out' as const }))
  const auth: AuthView = { state: 'authenticated', username: 'Mysterious', models: [] }
  const props = {
    logout,
    requestCredits: async () => ({ balance: 785.83 }),
    wide: true, controls: <button type="button">设置</button>,
    useAuth: <T,>(select: (state: AuthView) => T) => select(auth),
    t: (key: keyof typeof zh) => zh[key],
  } as Parameters<typeof AccountFooter>[0]
  render(<AccountFooter {...props} />)
  const trigger = screen.getByRole('button', { name: 'Mysterious' })
  expect(screen.queryByRole('button', { name: '设置' })).toBeNull()
  fireEvent.click(trigger)
  const settings = screen.getByRole('button', { name: '设置' })
  settings.focus()
  fireEvent.keyDown(settings, { key: 'Escape' })
  expect(document.activeElement).toBe(trigger)
  expect(screen.queryByRole('button', { name: '设置' })).toBeNull()
  fireEvent.click(trigger)
  expect(screen.getByRole('button', { name: '设置' })).toBe(settings)
  fireEvent.pointerDown(document.body)
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(trigger)
  await screen.findByText('785.83')
  const openCredits = vi.fn()
  window.addEventListener('dsh:open-settings-section', openCredits, { once: true })
  fireEvent.click(screen.getByRole('button', { name: /可用积分/ }))
  expect(openCredits.mock.calls[0]?.[0].detail).toBe('wanwei-credits')
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
  expect(logout).toHaveBeenCalledOnce()
  await screen.findByRole('button', { name: 'Mysterious', expanded: false })
})

it('keeps the account menu while hiding credits and check-in without balance requests', () => {
  const requestCredits = vi.fn()
  const props = {
    logout: vi.fn(), requestCredits, billing: { getSnapshot: () => false, subscribe: () => () => {} },
    wide: true, controls: <button type="button">设置</button>,
    useAuth: <T,>(select: (state: AuthView) => T) => select({ state: 'authenticated', username: 'Gov', models: [] }),
    t: (key: keyof typeof zh) => zh[key],
  } as Parameters<typeof AccountFooter>[0]
  render(<AccountFooter {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Gov' }))
  expect(screen.getByRole('button', { name: '设置' })).toBeTruthy()
  expect(screen.queryByText('签到领积分')).toBeNull()
  expect(screen.queryByText(zh.accountCreditsBalance)).toBeNull()
  expect(requestCredits).not.toHaveBeenCalled()
})
