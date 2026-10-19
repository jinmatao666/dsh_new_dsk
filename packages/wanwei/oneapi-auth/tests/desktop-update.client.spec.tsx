// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import { DesktopUpdateSection } from '../src/client/DesktopUpdateSection.tsx'

const t = makeTranslate(zh, commonZh)
const bridge = window as Window & { __ZJUGIS_NATIVE_INVOKE__?: (command: string, args: unknown) => Promise<unknown> }
afterEach(() => { cleanup(); delete bridge.__ZJUGIS_NATIVE_INVOKE__ })
it('has no executable update controls in a standalone browser', () => {
  const { container } = render(<DesktopUpdateSection t={t} />)
  expect(container.textContent).toBe('')
})
it('shows version, persists the preference and delegates checking only to the native shell', async () => {
  let automatic = true
  const invoke = vi.fn(async (command: string, args: unknown) => {
    if (command === 'desktop_update_automatic') automatic = (args as { enabled: boolean }).enabled
    return { configured: true, automatic, currentVersion: '1.2.0', phase: 'idle', message: '', received: 0, total: 0 }
  })
  bridge.__ZJUGIS_NATIVE_INVOKE__ = invoke
  render(<DesktopUpdateSection t={t} />)
  await screen.findByText(/1\.2\.0/)
  expect(screen.getByLabelText(zh.updatesTitle).textContent).toMatchSnapshot()
  expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(true)
  fireEvent.click(screen.getByRole('checkbox'))
  await waitFor(() => { expect(invoke).toHaveBeenCalledWith('desktop_update_automatic', { enabled: false }) })
  await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(false) })
  fireEvent.click(screen.getByRole('button', { name: zh.updatesCheck }))
  await waitFor(() => { expect(invoke).toHaveBeenCalledWith('desktop_update_check', {}) })
})
it('disables checking without a baked public key and reports native failures', async () => {
  bridge.__ZJUGIS_NATIVE_INVOKE__ = async () => ({ configured: false, automatic: true, currentVersion: '1.0.0', phase: 'idle', message: '', received: 0, total: 0 })
  const first = render(<DesktopUpdateSection t={t} />)
  await screen.findByText(zh.updatesUnavailable)
  expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(true)
  first.unmount()
  bridge.__ZJUGIS_NATIVE_INVOKE__ = async () => { throw new Error('Native offline') }
  render(<DesktopUpdateSection t={t} />)
  await screen.findByRole('alert')
  expect(screen.getByRole('alert').textContent).toContain('Native offline')
})
