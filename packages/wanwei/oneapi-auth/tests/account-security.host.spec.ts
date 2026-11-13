import { afterEach, expect, it, vi } from 'vitest'
import { accountSecurityRequest } from '../src/account-security.ts'
afterEach(() => vi.unstubAllGlobals())
it('only exposes masked status and never forwards full profile credentials', async () => {
  const fetcher = vi.fn(async (url: string) => Response.json({ success: true, data: url.endsWith('/status')
    ? { has_phone: true, phone: '138****0000', phone_verified: true }
    : { wechat_id: 'wx_private', access_token: 'secret', email: 'private@example.com' } }))
  vi.stubGlobal('fetch', fetcher)
  const value = await accountSecurityRequest('https://server.test', 'host-token', 'status', {}, new AbortController().signal)
  expect(value).toEqual({ username: '', phoneBound: true, phone: '138****0000', wechatBound: true })
  expect(JSON.stringify(value)).not.toMatch(/secret|wx_private|private@example/)
})
it('rejects arbitrary destinations', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  await expect(accountSecurityRequest('https://server.test', 'token', 'https://evil.test', {}, new AbortController().signal)).rejects.toThrow('未知')
  expect(fetcher).not.toHaveBeenCalled()
})
it('sends password changes to the authenticated fixed endpoint and propagates business failures', async () => {
  const fetcher = vi.fn(async (_url: string) => Response.json({ success: false, message: '验证码错误或已过期' })); vi.stubGlobal('fetch', fetcher)
  await expect(accountSecurityRequest('https://server.test', 'token', 'password', { code: '123456', new_password: 'password123' }, new AbortController().signal)).rejects.toThrow('验证码错误')
  expect(fetcher.mock.calls[0]?.[0]).toBe('https://server.test/api/user/self/phone/reset-password')
})

it('rejects authorization pages from non-WeChat servers', async () => {
  const fetcher = vi.fn(async () => Response.json({ success: true, data: { state: 'state', qrconnect_url: 'http://127.0.0.1/private' } }))
  vi.stubGlobal('fetch', fetcher)
  await expect(accountSecurityRequest('https://server.test', 'token', 'wechat-qr', {}, new AbortController().signal)).rejects.toThrow('微信授权页面无效')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('links a scanned WeChat to the authenticated account with optional phone verification', async () => {
  const fetcher = vi.fn(async () => Response.json({ success: true }))
  vi.stubGlobal('fetch', fetcher)
  await accountSecurityRequest('https://server.test', 'host-token', 'wechat-bind', { state: 'scan' }, new AbortController().signal)
  expect(fetcher).toHaveBeenLastCalledWith('https://server.test/api/oauth/wechat/quick-bind?state=scan', expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer host-token' }) }))
  await accountSecurityRequest('https://server.test', 'host-token', 'wechat-bind', { state: 'scan', phone_code: '123456' }, new AbortController().signal)
  expect(fetcher).toHaveBeenLastCalledWith('https://server.test/api/oauth/wechat/quick-bind?state=scan&phone_code=123456', expect.anything())
})
it('returns the live validated authorization page instead of fetching a detached image', async () => {
  const url = new URL('https://open.weixin.qq.com/connect/qrconnect')
  for (const [key, value] of Object.entries({ appid: 'app', state: 'scan', scope: 'snsapi_login', redirect_uri: 'http://server.test:3300/api/oauth/wechat' })) url.searchParams.set(key, value)
  const fetcher = vi.fn(async () => Response.json({ success: true, data: { state: 'scan', qrconnect_url: url.href } }))
  vi.stubGlobal('fetch', fetcher)
  const result = await accountSecurityRequest('https://server.test', 'host-token', 'wechat-qr', {}, new AbortController().signal) as { state: string; authorization_url: string }
  expect(result.state).toBe('scan')
  expect(new URL(result.authorization_url).searchParams.get('self_redirect')).toBe('true')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
