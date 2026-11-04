import { afterEach, expect, it, vi } from 'vitest'
import { accountSecurityRequest } from '../src/account-security.ts'
afterEach(() => vi.unstubAllGlobals())
it('only exposes masked status and never forwards full profile credentials', async () => {
  const fetcher = vi.fn(async (url: string) => Response.json({ success: true, data: url.endsWith('/status')
    ? { has_phone: true, phone: '138****0000', phone_verified: true }
    : { wechat_id: 'wx_private', access_token: 'secret', email: 'private@example.com' } }))
  vi.stubGlobal('fetch', fetcher)
  const value = await accountSecurityRequest('https://server.test', 'host-token', 'status', {}, new AbortController().signal)
  expect(value).toEqual({ phoneBound: true, phone: '138****0000', wechatBound: true })
  expect(JSON.stringify(value)).not.toMatch(/secret|wx_private|private@example/)
})
it('rejects arbitrary destinations and preserves verification requirements', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  await expect(accountSecurityRequest('https://server.test', 'token', 'https://evil.test', {}, new AbortController().signal)).rejects.toThrow('未知')
  await expect(accountSecurityRequest('https://server.test', 'token', 'wechat-bind', { state: 'state' }, new AbortController().signal)).rejects.toThrow('验证码')
  expect(fetcher).not.toHaveBeenCalled()
})
it('sends password changes to the authenticated fixed endpoint and propagates business failures', async () => {
  const fetcher = vi.fn(async (_url: string) => Response.json({ success: false, message: '验证码错误或已过期' })); vi.stubGlobal('fetch', fetcher)
  await expect(accountSecurityRequest('https://server.test', 'token', 'password', { code: '123456', new_password: 'password123' }, new AbortController().signal)).rejects.toThrow('验证码错误')
  expect(fetcher.mock.calls[0]?.[0]).toBe('https://server.test/api/user/self/phone/reset-password')
})

it('rejects QR images from non-WeChat servers before fetching the image', async () => {
  const fetcher = vi.fn(async () => Response.json({ success: true, data: { state: 'state', qr_url: 'http://127.0.0.1/private' } }))
  vi.stubGlobal('fetch', fetcher)
  await expect(accountSecurityRequest('https://server.test', 'token', 'wechat-qr', {}, new AbortController().signal)).rejects.toThrow('二维码暂不可用')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
