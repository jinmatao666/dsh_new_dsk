import { afterEach, expect, it, vi } from 'vitest'
import { publicAuthRequest } from '../src/public-auth.ts'
afterEach(() => vi.unstubAllGlobals())
const signal = () => new AbortController().signal
it('keeps unknown phones in onboarding instead of failing or creating an account', async () => {
  const fetcher = vi.fn(async () => Response.json({ success: false, code: 'phone_not_registered', register_enabled: true }))
  vi.stubGlobal('fetch', fetcher)
  const result = await publicAuthRequest('https://server.test', 'sms', { phone: '13800138000', code: '123456' }, signal())
  expect(result.value.code).toBe('phone_not_registered')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('requires explicit consent and sends server-readable booleans for registration', async () => {
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ success: true })); vi.stubGlobal('fetch', fetcher)
  await expect(publicAuthRequest('https://server.test', 'register', { phone: '13800138000' }, signal())).rejects.toThrow('同意')
  expect(fetcher).not.toHaveBeenCalled()
  await publicAuthRequest('https://server.test', 'register', { phone: '13800138000', agreed: 'true', password: '' }, signal())
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ use_login_sms: true, agreed: true, password: '' })
})
it('rejects arbitrary routes, invalid phones, business failures and foreign QR URLs', async () => {
  const fetcher = vi.fn(async () => Response.json({ success: false, message: '验证码错误' })); vi.stubGlobal('fetch', fetcher)
  await expect(publicAuthRequest('https://server.test', 'evil', {}, signal())).rejects.toThrow('未知')
  await expect(publicAuthRequest('https://server.test', 'sms', { phone: '123' }, signal())).rejects.toThrow('手机号')
  expect(fetcher).not.toHaveBeenCalled()
  await expect(publicAuthRequest('https://server.test', 'sms', { phone: '13800138000' }, signal())).rejects.toThrow('验证码错误')
  fetcher.mockImplementation(async () => Response.json({ success: true, data: { qr_url: 'http://127.0.0.1/secret' } }))
  await expect(publicAuthRequest('https://server.test', 'qr', {}, signal())).rejects.toThrow()
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('uses the existing password login route without requiring a phone', async () => {
  const fetcher = vi.fn(async () => Response.json({ success: true, data: { username: 'yxh' } }))
  vi.stubGlobal('fetch', fetcher)
  await publicAuthRequest('https://server.test', 'password', { username: 'yxh', password: 'secret', wechat_state: 'scan' }, signal())
  expect(fetcher).toHaveBeenCalledWith('https://server.test/api/user/login', expect.objectContaining({ method: 'POST' }))
})

it('keeps the official authorization page alive for scan confirmation and callback', async () => {
  const source = new URL('https://open.weixin.qq.com/connect/qrconnect')
  for (const [key, value] of Object.entries({ appid: 'app', scope: 'snsapi_login', state: 'scan', redirect_uri: 'http://server.test:3300/api/oauth/wechat' })) source.searchParams.set(key, value)
  const fetcher = vi.fn(async () => Response.json({ success: true, data: { state: 'scan', qrconnect_url: source.href } }))
  vi.stubGlobal('fetch', fetcher)
  const { value } = await publicAuthRequest('http://server.test:3300', 'qr', {}, signal())
  const url = new URL(String(value.data?.authorization_url))
  expect(url.origin).toBe('https://open.weixin.qq.com')
  expect(url.searchParams.get('self_redirect')).toBe('true')
  expect(url.searchParams.get('login_type')).toBe('jssdk')
  expect(url.searchParams.get('redirect_uri')).toBe('http://server.test:3300/api/oauth/wechat')
  expect(value.data?.state).toBe('scan')
  expect(fetcher).toHaveBeenCalledTimes(1)
  source.searchParams.set('state', 'other-state')
  await expect(publicAuthRequest('http://server.test:3300', 'qr', {}, signal())).rejects.toThrow('授权页面无效')
})
