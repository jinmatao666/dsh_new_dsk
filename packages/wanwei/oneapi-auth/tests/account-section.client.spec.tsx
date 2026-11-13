// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { AccountSection, type AccountSectionProps } from '../src/client/AccountSection.tsx'
import type { AuthState } from '../src/contract.ts'
import { zh } from '../src/client/locales.ts'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(cleanup)
const requestAccount = vi.fn(async () => ({ phoneBound: true, phone: '138****0000', wechatBound: false }))

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
    render(<AccountSection {...kit} useAuth={useAuth} logout={logout} requestAccount={requestAccount} close={close} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: zh.signOut }))
    expect(logout).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.signingOut }).disabled).toBe(true)
    finish({ state: 'logged-out' })
    await waitFor(() => { expect(close).toHaveBeenCalledOnce() })
  })

  it('retains settings and shows the error when logout fails', async () => {
    const logout = vi.fn(() => Promise.reject(new Error('Logout unavailable')))
    const close = vi.fn()
    render(<AccountSection {...kit} useAuth={useAuth} logout={logout} requestAccount={requestAccount} close={close} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: zh.signOut }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Logout unavailable') })
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /退出|sign/i }).disabled).toBe(false)
  })
})

it('shows the three security operations and no model inventory', async () => {
  const request = vi.fn(async (op: string) => op === 'status'
    ? { phoneBound: true, phone: '138****0000', wechatBound: true }
    : { captcha_id: 'captcha', captcha_image: 'data:image/png;base64,aA==' })
  render(<AccountSection {...kit} useAuth={selector => selector({ state: 'authenticated', username: 'wanwei', models: ['private-model'] })}
    logout={vi.fn()} requestAccount={request} close={vi.fn()} t={t} />)
  expect(await screen.findByText('138****0000')).toBeTruthy()
  expect(screen.queryByText('private-model')).toBeNull()
  expect(screen.queryByText(zh.models)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh.securityPasswordAction }))
  await screen.findByLabelText(zh.securityNewPassword)
  expect(screen.queryByLabelText(zh.securityCaptcha)).toBeNull()
  expect(request).not.toHaveBeenCalledWith('captcha')
  fireEvent.change(screen.getByLabelText(zh.securitySmsCode), { target: { value: '123456' } })
  fireEvent.change(screen.getByLabelText(zh.securityNewPassword), { target: { value: 'newpass123' } })
  fireEvent.change(screen.getByLabelText(zh.securityConfirmPassword), { target: { value: 'newpass123' } })
  fireEvent.submit(screen.getByRole('button', { name: zh.securityConfirm }).closest('form')!)
  await waitFor(() => expect(request).toHaveBeenCalledWith('password', { code: '123456', new_password: 'newpass123' }))
  expect(await screen.findByText(zh.securitySaved)).toBeTruthy()
})
it('does not label a failed status read as an unbound account', async () => {
  render(<AccountSection {...kit} useAuth={useAuth} logout={vi.fn()} requestAccount={async () => { throw new Error('服务不可用') }} close={vi.fn()} t={t} />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.securityBindPhone }).disabled).toBe(true)
})

it('requires separate old and new phone codes when replacing a phone', async () => {
  const request = vi.fn(async (op: string) => op === 'status'
    ? { phoneBound: true, phone: '138****0000', wechatBound: true }
    : { captcha_id: 'captcha', captcha_image: 'data:image/png;base64,aA==' })
  render(<AccountSection {...kit} useAuth={useAuth} logout={vi.fn()} requestAccount={request} close={vi.fn()} t={t} />)
  await screen.findByText('138****0000')
  fireEvent.click(screen.getByRole('button', { name: zh.securityReplacePhone }))
  await screen.findByLabelText(zh.securityOldCode)
  fireEvent.change(screen.getByLabelText(zh.securityNewPhone), { target: { value: '13912345678' } })
  fireEvent.change(screen.getByLabelText(zh.securityOldCode), { target: { value: '111111' } })
  fireEvent.change(screen.getByLabelText(zh.securityNewCode), { target: { value: '222222' } })
  fireEvent.submit(screen.getByRole('button', { name: zh.securityConfirm }).closest('form')!)
  await waitFor(() => expect(request).toHaveBeenCalledWith('phone-replace', { old_code: '111111', new_phone: '13912345678', new_code: '222222' }))
})

it('opens a modal, preserves the overview, and clears the password draft on cancel', async () => {
  render(<AccountSection {...kit} useAuth={useAuth} logout={vi.fn()} requestAccount={requestAccount} close={vi.fn()} t={t} />)
  await screen.findByText('138****0000')
  const trigger = screen.getByRole('button', { name: zh.securityPasswordAction })
  trigger.focus(); fireEvent.click(trigger)
  const modal = await screen.findByRole('dialog', { name: zh.securityPasswordAction })
  expect(modal.getAttribute('aria-modal')).toBe('true')
  fireEvent.change(screen.getByLabelText(zh.securityNewPassword), { target: { value: 'private-draft' } })
  fireEvent.click(modal.querySelector('button[aria-label]')!)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  fireEvent.click(trigger)
  await screen.findByRole('dialog')
  expect(screen.getByLabelText<HTMLInputElement>(zh.securityNewPassword).value).toBe('')
})

it('explains the phone requirement on the password action without enabling it', async () => {
  render(<AccountSection {...kit} useAuth={useAuth} logout={vi.fn()} close={vi.fn()} t={t}
    requestAccount={async () => ({ phoneBound: false, phone: '', wechatBound: false })} />)
  const action = await screen.findByLabelText(zh.securityPasswordBindFirst)
  expect(action.getAttribute('tabindex')).toBe('0')
  expect(action.getAttribute('data-tooltip')).toBe(zh.securityPasswordBindFirst)
  expect(screen.getByRole('button', { name: zh.securityPasswordAction })).toHaveProperty('disabled', true)
})

it('links WeChat without requiring a phone for an existing password account and refreshes bound status', async () => {
  let bound = false
  const request = vi.fn(async (operation: string) => {
    if (operation === 'wechat-qr') return { state: 'scan', authorization_url: 'https://open.weixin.qq.com/connect/qrconnect?state=scan' }
    if (operation === 'wechat-poll') return { status: 'unbound' }
    if (operation === 'wechat-bind') bound = true
    return { phoneBound: false, phone: '', wechatBound: bound }
  })
  render(<AccountSection {...kit} useAuth={useAuth} logout={vi.fn()} requestAccount={request} close={vi.fn()} t={t} />)
  const button = await screen.findByRole<HTMLButtonElement>('button', { name: zh.securityBindWechat })
  await waitFor(() => expect(button.disabled).toBe(false))
  fireEvent.click(button)
  const frame = await screen.findByTitle(zh.securityWechatQr)
  expect(frame.tagName).toBe('IFRAME')
  expect(screen.queryByLabelText(zh.securitySmsCode)).toBeNull()
  await screen.findByText(zh.securityScanned, {}, { timeout: 4000 })
  fireEvent.click(screen.getByRole('button', { name: zh.securityConfirm }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('wechat-bind', { state: 'scan' }))
  await screen.findByText(zh.securityWechatBound)
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('keeps phone verification for phone-bound accounts when linking WeChat', async () => {
  const request = vi.fn(async (operation: string) => operation === 'status'
    ? { phoneBound: true, phone: '138****0000', wechatBound: false }
    : operation === 'wechat-qr' ? { state: 'scan', authorization_url: 'https://open.weixin.qq.com/connect/qrconnect' } : { status: 'unbound' })
  render(<AccountSection {...kit} useAuth={useAuth} logout={vi.fn()} requestAccount={request} close={vi.fn()} t={t} />)
  await screen.findByText('138****0000')
  fireEvent.click(screen.getByRole('button', { name: zh.securityBindWechat }))
  await screen.findByText(zh.securityScanned, {}, { timeout: 4000 })
  fireEvent.change(screen.getByLabelText(zh.securitySmsCode), { target: { value: '123456' } })
  fireEvent.submit(screen.getByRole('button', { name: zh.securityConfirm }).closest('form')!)
  await waitFor(() => expect(request).toHaveBeenCalledWith('wechat-bind', { state: 'scan', phone_code: '123456' }))
})


it('lets the user rename the shared login username to Chinese characters', async () => {
  let username = '13800138000'
  const request = vi.fn(async (operation: string, input?: Record<string, string>) => {
    if (operation === 'username') username = input?.username ?? username
    return { username, phoneBound: true, phone: '138****8000', wechatBound: false }
  })
  render(<AccountSection {...kit} useAuth={useAuth} logout={vi.fn()} requestAccount={request} close={vi.fn()} t={t} />)
  await screen.findByText('13800138000')
  fireEvent.click(screen.getByRole('button', { name: zh.securityRename }))
  fireEvent.change(screen.getByLabelText(zh.securityNewUsername), { target: { value: '测试用户_张' } })
  fireEvent.click(await screen.findByRole('button', { name: zh.securityConfirm }))
  await waitFor(() => { expect(request).toHaveBeenCalledWith('username', { username: '测试用户_张' }) })
  await screen.findByText('测试用户_张')
})

it('refreshes expired WeChat linking codes in place and leaves binding disabled', async () => {
  let issued = 0
  const request = vi.fn(async (operation: string) => operation === 'status'
    ? { phoneBound: false, phone: '', wechatBound: false }
    : operation === 'wechat-qr' ? { state: `scan-${++issued}`, authorization_url: 'https://open.weixin.qq.com/connect/qrconnect' } : { status: 'expired' })
  render(<AccountSection {...kit} useAuth={useAuth} logout={vi.fn()} requestAccount={request} close={vi.fn()} t={t} />)
  const button = await screen.findByRole<HTMLButtonElement>('button', { name: zh.securityBindWechat })
  await waitFor(() => expect(button.disabled).toBe(false))
  fireEvent.click(button)
  await screen.findByText(zh.loginQrExpiredTitle, {}, { timeout: 4000 })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.securityConfirm }).disabled).toBe(true)
  fireEvent.click(screen.getByText(zh.loginQrClickRefresh).closest('button')!)
  await waitFor(() => expect(issued).toBe(2))
  expect(screen.queryByText(zh.loginQrExpiredTitle)).toBeNull()
  const cancel = screen.getAllByRole<HTMLButtonElement>('button', { name: zh.securityCancel })[0]!
  await waitFor(() => expect(cancel.disabled).toBe(false))
  fireEvent.click(cancel)
  expect(screen.queryByRole('dialog')).toBeNull()
})
