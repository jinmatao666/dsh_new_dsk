// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import { DesktopUpdateSection, DesktopUpdateOverlay } from '../src/client/DesktopUpdateSection.tsx'
import { DesktopUpdateController } from '../src/client/desktop-update-controller.ts'

const t = makeTranslate(zh, commonZh)
const disposers: Array<() => void> = []
beforeEach(() => {
  // jsdom has no top-layer layout; browser acceptance verifies native dialog focus and geometry.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', '') },
  })
})
afterEach(() => { cleanup(); disposers.splice(0).forEach((stop) => { stop() }); vi.useRealTimers() })

function bench(phase = 'idle', configured = true, total = 104857600) {
  const state = { configured, automatic: true, currentVersion: '2.1.1', phase, message: '', received: 26214400, total }
  const invoke = vi.fn(async (command: string, args: unknown) => {
    if (command === 'desktop_update_automatic') state.automatic = (args as { enabled: boolean }).enabled
    return { ...state }
  })
  const updates = new DesktopUpdateController(invoke)
  disposers.push(updates.start())
  return { updates, invoke, state }
}

it('has no executable update controls in a standalone browser', () => {
  const updates = new DesktopUpdateController(undefined)
  const { container } = render(<DesktopUpdateSection t={t} updates={updates} />)
  expect(container.textContent).toBe('')
})

it('shows a dedicated version page, persists its switch and delegates checking to native', async () => {
  const { updates, invoke } = bench()
  render(<DesktopUpdateSection t={t} updates={updates} />)
  await screen.findByText('2.1.1')
  expect(screen.getByLabelText(zh.updatesTitle).textContent).toMatchSnapshot()
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  fireEvent.click(screen.getByRole('switch'))
  await waitFor(() => { expect(invoke).toHaveBeenCalledWith('desktop_update_automatic', { enabled: false }) })
  await waitFor(() => { expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false') })
  fireEvent.click(screen.getByRole('button', { name: zh.updatesCheck }))
  await waitFor(() => { expect(invoke).toHaveBeenCalledWith('desktop_update_check', {}) })
  expect(screen.queryByRole('progressbar')).toBeNull()
})

it('disables checking without a public key and reports native failures', async () => {
  const { updates } = bench('idle', false)
  const first = render(<DesktopUpdateSection t={t} updates={updates} />)
  await screen.findByText(zh.updatesUnavailable)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.updatesCheck }).disabled).toBe(true)
  first.unmount()
  const broken = new DesktopUpdateController(async () => { throw new Error('Native offline') })
  disposers.push(broken.start())
  render(<DesktopUpdateSection t={t} updates={broken} />)
  expect((await screen.findByRole('alert')).textContent).toContain('Native offline')
})

it('shows progress only in the body dialog and survives closing the version page', async () => {
  const { updates } = bench('downloading')
  const settings = render(<DesktopUpdateSection t={t} updates={updates} />)
  render(<DesktopUpdateOverlay t={t} updates={updates} />)
  const dialog = await screen.findByRole('dialog', { name: zh.updatesProgressTitle })
  expect(dialog.parentElement).toBe(document.body)
  expect(dialog.textContent).toContain('25%')
  expect(dialog.textContent).toContain('25.0 MB / 100.0 MB')
  expect(settings.container.querySelector('progress')).toBeNull()
  settings.unmount()
  expect(screen.getByRole('dialog')).toBe(dialog)
  fireEvent.click(screen.getByRole('button', { name: zh.updatesBackground }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(updates.getSnapshot().snapshot?.phase).toBe('downloading')
})

it('does not reopen a hidden download on every poll and permits explicit reopening', async () => {
  vi.useFakeTimers()
  const { updates, state } = bench('downloading')
  render(<><DesktopUpdateSection t={t} updates={updates} /><DesktopUpdateOverlay t={t} updates={updates} /></>)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  fireEvent.click(screen.getByRole('button', { name: zh.updatesBackground }))
  state.received = 52428800
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh.updatesShowProgress }))
  expect(screen.getByRole('dialog').textContent).toContain('50%')
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('keeps installation progress open and handles unknown download size without a false percentage', async () => {
  vi.useFakeTimers()
  const { updates, state } = bench('downloading', true, 0)
  render(<DesktopUpdateOverlay t={t} updates={updates} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  expect(screen.getByRole('progressbar').hasAttribute('value')).toBe(false)
  state.phase = 'installing'
  state.message = '正在安装更新'
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.updatesHide }).disabled).toBe(true)
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  expect(screen.getByRole('dialog')).toBeTruthy()
})

it('stops polling and ignores an in-flight status after plugin disposal', async () => {
  vi.useFakeTimers()
  let resolve: (value: unknown) => void = () => {}
  const invoke = vi.fn(() => new Promise((finish) => { resolve = finish }))
  const updates = new DesktopUpdateController(invoke)
  const stop = updates.start()
  stop()
  resolve({ configured: true, automatic: true, currentVersion: '2', phase: 'downloading', message: '', received: 1, total: 2 })
  await vi.advanceTimersByTimeAsync(5000)
  expect(invoke).toHaveBeenCalledOnce()
  expect(updates.getSnapshot().snapshot).toBeUndefined()
})
