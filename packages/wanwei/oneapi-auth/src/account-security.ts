/** Fixed account-security operations executed only by the credential-owning Host. */
import { Buffer } from 'node:buffer'
import type { AccountSecurity } from './contract.ts'

/** Perform an allowlisted operation without exposing tokens or complete user records.
 * @param baseURL - Configured authentication server.
 * @param token - Host-owned user credential.
 * @param operation - Fixed account operation.
 * @param input - Form values, never a destination URL.
 * @param signal - Operation lifetime.
 * @returns Sanitized status or service response data.
 */
export async function accountSecurityRequest(
  baseURL: string, token: string, operation: string, input: Record<string, string>, signal: AbortSignal,
): Promise<unknown> {
  const request = async (path: string, body?: Record<string, string>, raw = false): Promise<Record<string, unknown>> => {
    const response = await fetch(baseURL + path, { method: body ? 'POST' : 'GET', redirect: 'error', signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const value = await response.json() as { success?: boolean; message?: string; data?: Record<string, unknown> }
    if (!response.ok || (!raw && value.success !== true)) throw new Error(value.message || '账号操作失败，请稍后重试')
    return raw ? value as Record<string, unknown> : value.data ?? {}
  }
  if (operation === 'status') {
    const [phone, user] = await Promise.all([request('/api/user/self/phone/status'), request('/api/user/self')])
    return { phoneBound: phone.has_phone === true && phone.phone_verified === true, phone: typeof phone.phone === 'string' ? phone.phone : '', wechatBound: typeof user.wechat_id === 'string' && user.wechat_id.length > 0 } satisfies AccountSecurity
  }
  if (operation === 'wechat-qr') {
    const data = await request('/api/oauth/wechat/qr')
    if (typeof data.qr_url !== 'string' || !data.qr_url) throw new Error('微信二维码暂不可用，请稍后重试')
    const url = new URL(data.qr_url)
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.weixin.qq.com')) throw new Error('微信二维码暂不可用，请稍后重试')
    const image = await fetch(url, { signal, redirect: 'error' })
    if (!image.ok) throw new Error('无法加载微信二维码')
    const bytes = new Uint8Array(await image.arrayBuffer())
    const mime = image.headers.get('content-type')?.split(';')[0]
    if (bytes.length > 512000 || !['image/png', 'image/jpeg'].includes(mime ?? '')) throw new Error('微信二维码格式无效')
    return { state: data.state, image: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` }
  }
  if (operation === 'wechat-poll') return request('/api/oauth/wechat/poll?state=' + encodeURIComponent(input.state ?? ''), undefined, true)
  if (operation === 'wechat-bind') {
    if (!input.phone_code) throw new Error('请输入手机验证码')
    return request('/api/oauth/wechat/quick-bind?state=' + encodeURIComponent(input.state ?? '') + '&phone_code=' + encodeURIComponent(input.phone_code))
  }
  const routes: Record<string, string> = {
    'initial-password': '/api/user/self/password/initial',
    'send-new': '/api/user/self/phone/send-bind-code', 'send-current': '/api/user/self/phone/send-change-code',
    'send-password': '/api/user/self/phone/send-reset-code', 'phone-bind': '/api/user/self/phone/bind',
    'phone-replace': '/api/user/self/phone/replace', 'password': '/api/user/self/phone/reset-password', 'wechat-unbind': '/api/user/self/wechat/unbind',
  }
  const path = routes[operation]
  if (!path) throw new Error('未知账号操作')
  return request(path, operation === 'send-new' ? { ...input, purpose: 'phone_bind' } : input)
}
