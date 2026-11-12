/** Attach a one-use ticket for ais-land / hash-router pages.
 * Prefer `?ticket=` on the URL search (before `#`) so the iframe document can
 * read it as soon as scripts run; hash-query tickets are unreliable for silent login.
 * Non-hash pages fall back to `#ticket=` when no hash route is present.
 * @param pageUrl - Administrator-configured page URL.
 * @param ticket - 64-hex launch ticket.
 * @returns URL safe to load in the portal iframe.
 */
export function withPortalTicket(pageUrl: string, ticket: string): string {
  if (!/^[a-f0-9]{64}$/.test(ticket)) throw new Error('页面登录票据无效')
  const url = new URL(pageUrl)
  if (url.hash.startsWith('#/')) {
    url.searchParams.set('ticket', ticket)
    return url.href
  }
  url.hash = `ticket=${ticket}`
  return url.href
}
