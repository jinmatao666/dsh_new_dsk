// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { BrowserCard, type BrowserCardProps } from '../src/client/BrowserCard.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
function props(intranet = false): BrowserCardProps {
  return {
    t: makeTranslate(zh, commonZh),
    useSessions: () => { throw new Error('unused') },
    useWorkspaces: () => { throw new Error('unused') },
    useSessionPendingInteraction: () => { throw new Error('unused') },
    usePreference: selector => selector({ status: 'ready', value: { enabled: true },
      base: {}, user: {}, revision: 1, writable: true, mode: 'host' }),
    useNetwork: selector => selector({ mode: intranet ? 'intranet' : 'internet' }),
    setEnabled: vi.fn(async () => {}),
  }
}
it('shows the enabled switch and saves a disable choice', async () => {
  const face = props()
  render(<BrowserCard {...face} />)
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  fireEvent.click(screen.getByRole('switch'))
  await waitFor(() => { expect(face.setEnabled).toHaveBeenCalledWith(false) })
})
it('disables the switch in intranet mode without losing the saved preference', () => {
  const face = props(true)
  render(<BrowserCard {...face} />)
  expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  expect(screen.getByText(zh.intranet)).toBeDefined()
  fireEvent.click(screen.getByRole('switch'))
  expect(face.setEnabled).not.toHaveBeenCalled()
})
it('reports a failed save and permits retry', async () => {
  const face = props()
  face.setEnabled = vi.fn(async () => { throw new Error('write rejected') })
  render(<BrowserCard {...face} />)
  fireEvent.click(screen.getByRole('switch'))
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(zh.failed) })
  expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(false)
})
