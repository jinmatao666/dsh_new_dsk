/** Read published expert websites from Wanwei OneAPI.
 * @param baseURL - Administration service origin.
 * @param signal - Optional request cancellation.
 * @returns Published metadata for client validation.
 */
export async function listPublishedExperts(baseURL: string, signal?: AbortSignal): Promise<{ items: unknown[] }> {
  const response = await fetch(`${baseURL.replace(/\/+$/, '')}/api/expert-web/`, {
    redirect: 'error',
    ...(signal === undefined ? {} : { signal }),
  })
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > 1024 * 1024) throw new Error('专家目录响应过大')
  let body: unknown
  try { body = JSON.parse(text) as unknown }
  catch { throw new Error('专家目录返回了无效 JSON') }
  const result = body as { success?: unknown; message?: unknown; data?: unknown } | null
  if (!response.ok || result?.success !== true) {
    throw new Error(typeof result?.message === 'string' ? result.message : `专家目录暂时不可用（HTTP ${String(response.status)}）`)
  }
  return { items: Array.isArray(result.data) ? result.data : [] }
}

/** Request a short-lived website launch using the Host-held credential.
 * @param baseURL - Administration service origin.
 * @param key - Published expert identifier.
 * @param token - User credential, never forwarded to the website.
 * @param signal - Optional request cancellation.
 * @returns HTTPS address and single-use ticket.
 */
export async function launchExpertWebsite(
  baseURL: string, key: string, token: string, signal?: AbortSignal,
): Promise<{ url: string; ticket: string }> {
  if (!/^[a-z][a-z0-9-]{2,79}$/.test(key)) throw new Error('专家编号无效')
  const response = await fetch(`${baseURL.replace(/\/+$/, '')}/api/expert-web/${key}/launch`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    redirect: 'error',
    ...(signal === undefined ? {} : { signal }),
  })
  const body: unknown = await response.json()
  const result = body as { success?: unknown; message?: unknown; url?: unknown; ticket?: unknown } | null
  if (!response.ok || result?.success !== true || typeof result.url !== 'string' || typeof result.ticket !== 'string') {
    throw new Error(typeof result?.message === 'string' ? result.message : '无法打开专家工作台')
  }
  const url = new URL(result.url)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '') throw new Error('专家网页地址无效')
  return { url: url.href, ticket: result.ticket }
}
