/** Public login operations over fixed server routes; cookies remain Host-owned. */
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
    password: '/api/user/login', send: '/api/user/phone/send-code', sms: '/api/user/phone/login', register: '/api/user/phone/register',
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
    const url = new URL(String(data?.qrconnect_url || ''))
    if (url.origin !== 'https://open.weixin.qq.com' || url.pathname !== '/connect/qrconnect'
      || url.username || url.password || !data?.state || url.searchParams.get('state') !== data.state
      || !url.searchParams.get('appid') || url.searchParams.get('scope') !== 'snsapi_login') throw new Error('微信授权页面无效，请刷新二维码')
    const callback = new URL(url.searchParams.get('redirect_uri') || '')
    if (!['http:', 'https:'].includes(callback.protocol) || callback.username || callback.password
      || callback.pathname !== '/api/oauth/wechat' || callback.search || callback.hash) throw new Error('微信回调地址无效')
    // Match the iframe URL used by Tencent's official wxLogin.js. The authorization
    // page must stay alive to observe confirmation and navigate to the callback.
    const authorization = new URL('https://open.weixin.qq.com/connect/qrconnect')
    for (const key of ['appid', 'redirect_uri', 'scope', 'state']) authorization.searchParams.set(key, url.searchParams.get(key) ?? '')
    authorization.searchParams.set('login_type', 'jssdk')
    authorization.searchParams.set('self_redirect', 'true')
    authorization.searchParams.set('fast_login', '0')
    return { value: { ...value, data: { state: data.state, authorization_url: authorization.href } }, headers: response.headers }
  }
  return { value, headers: response.headers }
}
