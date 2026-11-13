/** Fixed account-security operations executed only by the credential-owning Host. */
import { publicAuthRequest } from './public-auth.ts'
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
    const userId = typeof user.id === 'number' && Number.isSafeInteger(user.id) && user.id > 0 ? String(user.id) : undefined
    return { ...(userId === undefined ? {} : { userId }), username: typeof user.username === 'string' ? user.username : '', phoneBound: phone.has_phone === true && phone.phone_verified === true, phone: typeof phone.phone === 'string' ? phone.phone : '', wechatBound: typeof user.wechat_id === 'string' && user.wechat_id.length > 0 } satisfies AccountSecurity
  }
  if (operation === 'wechat-qr') {
    const { value } = await publicAuthRequest(baseURL, 'qr', {}, signal)
    return value.data
  }
  if (operation === 'wechat-poll') return request('/api/oauth/wechat/poll?state=' + encodeURIComponent(input.state ?? ''), undefined, true)
  if (operation === 'wechat-bind') {
    return request('/api/oauth/wechat/quick-bind?state=' + encodeURIComponent(input.state ?? '') + (input.phone_code ? '&phone_code=' + encodeURIComponent(input.phone_code) : ''))
  }
  const routes: Record<string, string> = {
    username: '/api/user/self/username',
    'initial-password': '/api/user/self/password/initial',
    'send-new': '/api/user/self/phone/send-bind-code', 'send-current': '/api/user/self/phone/send-change-code',
    'send-password': '/api/user/self/phone/send-reset-code', 'phone-bind': '/api/user/self/phone/bind',
    'phone-replace': '/api/user/self/phone/replace', 'password': '/api/user/self/phone/reset-password', 'wechat-unbind': '/api/user/self/wechat/unbind',
  }
  const path = routes[operation]
  if (!path) throw new Error('未知账号操作')
  if (operation === 'username') return request(path, { username: input.username ?? '' })
  return request(path, operation === 'send-new' ? { ...input, purpose: 'phone_bind' } : input)
}
