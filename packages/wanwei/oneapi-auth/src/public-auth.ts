/** Public login operations over fixed server routes; cookies remain Host-owned. */
import { Buffer } from 'node:buffer'
/** Bounded string fields accepted by fixed public authentication routes. */
export type PublicAuthInput = Record<string, string>

interface PublicAuthEnvelope {
  success?: boolean
  code?: string
  message?: string
  register_enabled?: boolean
  status?: string
  data?: Record<string, unknown>
}

/** Call a fixed login endpoint; never accept caller-selected URLs.
 * @param base - Configured server address.
 * @param op - Supported authentication operation.
 * @param input - Bounded form input.
 * @param signal - Cancellation.
 * @returns Server envelope and response headers, for Host session establishment only.
 */
export async function publicAuthRequest(
  base: string, op: string, input: PublicAuthInput, signal: AbortSignal,
): Promise<{ value: PublicAuthEnvelope; headers: Headers }> {
  const routes: Record<string, string> = { capabilities: '/api/desktop-auth/capabilities', captcha: '/api/captcha',
    send: '/api/user/phone/send-code', sms: '/api/user/phone/login', register: '/api/user/phone/register',
    reset: '/api/user/phone/reset-password', qr: '/api/oauth/wechat/qr', poll: '/api/oauth/wechat/poll' }
  const path = routes[op]
  if (!path) throw new Error('未知登录操作')
  if (['send', 'sms', 'register', 'reset'].includes(op) && !/^1[3-9]\d{9}$/.test(input.phone ?? '')) throw new Error('请输入有效手机号')
  if (op === 'register' && input.agreed !== 'true') throw new Error('请阅读并同意用户协议和隐私政策')
  const get = ['capabilities', 'captcha', 'qr', 'poll'].includes(op)
  const body = { ...input, ...(op === 'register' ? { use_login_sms: true, agreed: input.agreed === 'true' } : {}) }
  const response = await fetch(base + path + (op === 'poll' ? '?state=' + encodeURIComponent(input.state ?? '') : ''), {
    method: get ? 'GET' : 'POST', signal, redirect: 'error', headers: { 'content-type': 'application/json' },
    ...(get ? {} : { body: JSON.stringify(body) }),
  })
  const value = await response.json() as PublicAuthEnvelope
  if (!response.ok || value.success === false && value.code !== 'phone_not_registered') throw new Error(value.message || '登录服务暂不可用')
  if (op === 'qr') {
    const data = value.data
    const url = new URL(String(data?.qr_url || ''))
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.weixin.qq.com')) throw new Error('微信二维码加载失败')
    const image = await fetch(url, { signal, redirect: 'error' })
    const bytes = new Uint8Array(await image.arrayBuffer()); const mime = image.headers.get('content-type')?.split(';')[0]
    if (!image.ok || bytes.length > 512000 || !['image/png', 'image/jpeg'].includes(mime ?? '')) throw new Error('微信二维码格式无效')
    return { value: { ...value, data: { state: data?.state, image: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` } }, headers: response.headers }
  }
  return { value, headers: response.headers }
}
