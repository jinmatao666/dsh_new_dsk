/** Fixed credit operations over the credential-owning Host.
 * @param baseURL - Configured service origin.
 * @param token - Host-owned user credential.
 * @param operation - Allowlisted credit operation.
 * @param page - Zero-based history page.
 * @param filter - History category.
 * @param signal - Request lifetime.
 * @returns Personal balance, history or check-in status.
 */
export async function creditsRequest(
  baseURL: string, token: string, operation: string, page: number, filter: string, signal: AbortSignal,
): Promise<unknown> {
  if (!['status', 'claim', 'history'].includes(operation)) throw new Error('未知积分操作')
  const path = operation === 'history' ? `/api/user/self/credits?page=${page}&filter=${encodeURIComponent(filter)}` : '/api/user/self/checkin'
  const response = await fetch(baseURL + path, { method: operation === 'claim' ? 'POST' : 'GET', redirect: 'error', signal, headers: { authorization: `Bearer ${token}` } })
  const result = await response.json() as { success?: boolean; message?: string; data?: unknown }
  if (!response.ok || result.success !== true) throw new Error(result.message || '积分服务暂不可用')
  return result.data
}
