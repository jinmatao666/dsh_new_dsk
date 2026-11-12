/** Request a short-lived portal launch using the Host-held user credential.
 * @param baseURL - Administration service origin.
 * @param token - User credential, never forwarded to the website.
 * @param portal - Portal whose ticket the website can redeem.
 * @param signal - Optional request cancellation.
 * @returns HTTP or HTTPS address and single-use ticket.
 */
export async function launchDesktopPortal(
  baseURL: string, token: string, portal: 'land-market' | 'planning-lecture', signal?: AbortSignal,
): Promise<{ url: string; ticket: string }> {
  const label = portal === 'land-market' ? '土地市场' : '资规讲坛'
  const response = await fetch(`${baseURL.replace(/\/+$/, '')}/api/portal/${portal}/launch`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    redirect: 'error',
    ...(signal === undefined ? {} : { signal }),
  })
  const body: unknown = await response.json()
  const result = body as { success?: unknown; message?: unknown; url?: unknown; ticket?: unknown } | null
  if (!response.ok || result?.success !== true || typeof result.url !== 'string' || typeof result.ticket !== 'string') {
    throw new Error(typeof result?.message === 'string' ? result.message : `无法打开${label}`)
  }
  const url = new URL(result.url)
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '') {
    throw new Error(`${label}页面地址无效`)
  }
  return { url: result.url, ticket: result.ticket }
}
