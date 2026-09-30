/** Product-owned deployment policy; this does not replace a network firewall. */
export type NetworkEnvironment = 'internet' | 'intranet'
export interface NetworkState {
  mode: NetworkEnvironment
  internalOrigins: readonly string[]
}
/** Classify literal private addresses, local DNS names and configured service origins. */
export function internalLink(address: string, origins: readonly string[]): boolean {
  let url: URL
  try { url = new URL(address) } catch { return false }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (origins.includes(url.origin)) return true
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) return true
  if (/^(?:fc|fd)[0-9a-f]{2}:|^fe[89ab][0-9a-f]:/i.test(host)) return true
  if (/^[\d.]+$/.test(host)) {
    const parts = host.split('.').map(Number)
    const second = parts[1] ?? -1
    return parts.length === 4 && parts.every(part => part >= 0 && part <= 255)
      && (parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168)
        || (parts[0] === 172 && second >= 16 && second <= 31)
        || (parts[0] === 169 && parts[1] === 254))
  }
  return !host.includes('.') || /\.(local|internal|lan)$/.test(host)
}
