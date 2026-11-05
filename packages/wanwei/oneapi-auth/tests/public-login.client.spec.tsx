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
  const request = vi.fn(async (op: string) => op === 'capabilities' ? { success: true, data: cap }
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
    : op === 'qr' ? { data: { state: 'owned-state', image: 'data:image/png;base64,AA==' } }
      : op === 'poll' ? { status: 'need_bind_phone' } : { state: 'authenticated' })
  render(<PublicLogin mode='qr' request={request} onBack={() => {}} t={t} />)
  await screen.findByLabelText(zh.securityPhone, {}, { timeout: 3500 }); inputs()
  fireEvent.click(screen.getByRole('button', { name: zh.loginBindPhoneEnter }))
  await waitFor(() =>{  expect(request).toHaveBeenCalledWith('wechat-phone-bind', expect.objectContaining({ state: 'owned-state', phone: '13800138000' }), expect.anything()) })
  expect(request.mock.calls.some(([op]) => op === 'register' || op === 'sms')).toBe(false)
})
