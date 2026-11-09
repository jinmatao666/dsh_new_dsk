/** Request a short-lived land-market launch using the Host-held user credential.
 * @param baseURL - Administration service origin.
 * @param token - User credential, never forwarded to the website.
 * @param signal - Optional request cancellation.
 * @returns HTTP or HTTPS address and single-use ticket.
 */
export async function launchLandMarket(
  baseURL: string, token: string, signal?: AbortSignal,
): Promise<{ url: string; ticket: string }> {
  const response = await fetch(`${baseURL.replace(/\/+$/, '')}/api/portal/land-market/launch`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    redirect: 'error',
    ...(signal === undefined ? {} : { signal }),
  })
  const body: unknown = await response.json()
  const result = body as { success?: unknown; message?: unknown; url?: unknown; ticket?: unknown } | null
  if (!response.ok || result?.success !== true || typeof result.url !== 'string' || typeof result.ticket !== 'string') {
    throw new Error(typeof result?.message === 'string' ? result.message : '无法打开土地市场')
  }
  const url = new URL(result.url)
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '') {
    throw new Error('土地市场页面地址无效')
  }
  return { url: result.url, ticket: result.ticket }
}
