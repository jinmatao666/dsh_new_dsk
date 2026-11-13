// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PublicLogin } from '../src/client/PublicLogin.tsx'
import { zh } from '../src/client/locales.ts'
beforeEach(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') } })
afterEach(cleanup)
const cap = { sms: true, reset: true, register: true, wechat: false, captcha: false, agreement: '协议正文', privacy: '隐私正文' }
const t = (key: string) => zh[key as keyof typeof zh]
function inputs() {
  fireEvent.change(screen.getByLabelText(zh.securityPhone), { target: { value: '13800138000' } })
  fireEvent.change(screen.getByLabelText(zh.loginSmsCode), { target: { value: '123456' } })
}
it('registers an unknown phone on login submission without a separate consent checkbox', async () => {
  const request = vi.fn(async (op: string) => op === 'capabilities' ? { success: true, data: { ...cap, agreement: '', privacy: '' } }
    : op === 'sms' ? { success: false, code: 'phone_not_registered', register_enabled: true } : { state: 'authenticated' })
  render(<PublicLogin mode='sms' request={request} onBack={() => {}} t={t} />)
  await screen.findByLabelText(zh.securityPhone); inputs()
  fireEvent.click(screen.getByRole('button', { name: zh.loginOrRegister }))
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(screen.getByText(zh.loginCodePrivacyHint)).toBeTruthy()
  await waitFor(() =>{  expect(request).toHaveBeenCalledWith('register', expect.objectContaining({ phone: '13800138000', password: '', agreed: 'true' }), expect.anything()) })
  expect(screen.queryByText(zh.loginCreateAccount)).toBeNull()
})
it('preserves existing accounts and surfaces rejected verification without entering registration', async () => {
  const request = vi.fn(async (op: string) => { if (op === 'capabilities') return { data: cap }; throw new Error('验证码已过期') })
  render(<PublicLogin mode='sms' request={request} onBack={() => {}} t={t} />)
  await screen.findByLabelText(zh.securityPhone); inputs()
  fireEvent.click(screen.getByRole('button', { name: zh.loginOrRegister }))
  expect((await screen.findByRole('alert')).textContent).toBe('验证码已过期')
  expect(screen.queryByText(zh.loginCreateAccount)).toBeNull()
})
it('resets passwords independently of whether SMS login is enabled', async () => {
  const request = vi.fn(async (op: string) => ({ data: op === 'capabilities' ? { ...cap, sms: false } : {} }))
  render(<PublicLogin mode='reset' request={request} onBack={() => {}} t={t} />)
  await screen.findByLabelText(zh.securityPhone); inputs()
  fireEvent.change(screen.getByLabelText(zh.securityNewPassword), { target: { value: 'password123' } })
  fireEvent.change(screen.getByLabelText(zh.securityConfirmPassword), { target: { value: 'password123' } })
  fireEvent.click(screen.getByRole('button', { name: zh.securityPasswordAction }))
  await waitFor(() =>{  expect(request).toHaveBeenCalledWith('reset', expect.objectContaining({ new_password: 'password123' }), expect.anything()) })
  await screen.findByText(zh.loginPasswordSaved)
})
it('cancels pending public-auth calls on leaving the login mode', async () => {
  let received: AbortSignal | undefined
  const request = vi.fn((_op: string, _input: Record<string, string>, signal?: AbortSignal) => {
    received = signal; return new Promise(() => {})
  })
  const view = render(<PublicLogin mode='sms' request={request} onBack={() => {}} t={t} />)
  expect(received?.aborted).toBe(false); view.unmount(); expect(received?.aborted).toBe(true)
})

it('completes phone binding for an existing WeChat account without registering another user', async () => {
  const request = vi.fn(async (op: string) => op === 'capabilities' ? { data: { ...cap, wechat: true } }
    : op === 'qr' ? { data: { state: 'owned-state', authorization_url: 'https://open.weixin.qq.com/connect/qrconnect?state=test' } }
      : op === 'poll' ? { status: 'need_bind_phone' } : { state: 'authenticated' })
  render(<PublicLogin mode='qr' request={request} onBack={() => {}} t={t} />)
  await screen.findByLabelText(zh.securityPhone, {}, { timeout: 3500 }); inputs()
  fireEvent.click(screen.getByRole('button', { name: zh.loginBindPhoneEnter }))
  await waitFor(() =>{  expect(request).toHaveBeenCalledWith('wechat-phone-bind', expect.objectContaining({ state: 'owned-state', phone: '13800138000' }), expect.anything()) })
  expect(request.mock.calls.some(([op]) => op === 'register' || op === 'sms')).toBe(false)
})


it('links an existing password account after scanning without requiring a phone', async () => {
  const request = vi.fn(async (op: string) => op === 'capabilities' ? { data: { ...cap, wechat: true } }
    : op === 'qr' ? { data: { state: 'link-state', authorization_url: 'https://open.weixin.qq.com/connect/qrconnect?state=test' } }
      : op === 'poll' ? { status: 'unbound' } : { state: 'authenticated' })
  render(<PublicLogin mode='qr' request={request} onBack={() => {}} t={t} />)
  await screen.findByRole('dialog', { name: zh.loginBindPhoneTitle }, { timeout: 3500 })
  expect(screen.getByRole('button', { name: zh.loginBindAndContinue })).toBeTruthy()
  const choosePassword = screen.getByRole('button', { name: zh.loginLinkByPassword })
  fireEvent.click(choosePassword)
  expect(screen.queryByLabelText(zh.securityPhone)).toBeNull()
  fireEvent.change(screen.getByLabelText(zh.username), { target: { value: 'yxh' } })
  fireEvent.change(screen.getByLabelText(zh.password), { target: { value: 'password123' } })
  fireEvent.click(screen.getByRole('button', { name: zh.loginLinkAccount }))
  await waitFor(() => { expect(request).toHaveBeenCalledWith('password', { username: 'yxh', password: 'password123', wechat_state: 'link-state' }, expect.anything()) })
  expect(request.mock.calls.some(([op]) => ['send', 'sms', 'register'].includes(op))).toBe(false)
})

it('renders a live authorization frame rather than a detached QR image', async () => {
  const authorization = 'https://open.weixin.qq.com/connect/qrconnect?state=live'
  const request = vi.fn(async (op: string) => op === 'capabilities' ? { data: { ...cap, wechat: true } }
    : op === 'qr' ? { data: { state: 'live', authorization_url: authorization } } : { status: 'pending' })
  const { container } = render(<PublicLogin mode='qr' request={request} onBack={() => {}} t={t} />)
  const frame = await screen.findByTitle(zh.loginQrAlt)
  expect(frame.tagName).toBe('IFRAME')
  expect(frame.getAttribute('src')).toBe(authorization)
  expect(container.querySelector('img')).toBeNull()
})

it('shows QR expiry over the frame and refreshes without opening an error dialog', async () => {
  let issued = 0
  const request = vi.fn(async (op: string) => op === 'capabilities' ? { data: { ...cap, wechat: true } }
    : op === 'qr' ? { data: { state: `scan-${++issued}`, authorization_url: 'https://open.weixin.qq.com/connect/qrconnect' } }
      : { status: 'expired', message: '二维码已过期' })
  render(<PublicLogin mode='qr' request={request} onBack={() => {}} t={t} />)
  await screen.findByText(zh.loginQrExpiredTitle, {}, { timeout: 3500 })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByTitle(zh.loginQrAlt)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /二维码已过期/ }))
  await waitFor(() => { expect(issued).toBe(2) })
  await waitFor(() => { expect(screen.queryByText(zh.loginQrExpiredTitle)).toBeNull() })
})
