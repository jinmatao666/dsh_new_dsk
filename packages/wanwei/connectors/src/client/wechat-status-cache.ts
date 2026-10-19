import type { WeChatStatus } from './WeChatPanel.tsx'

const STORAGE_KEY = 'wanwei.wechat.assistantStatus'

/**
 * Read the last painted WeChat Assistant status for instant card paint.
 * @returns cached status or null.
 */
export function getCachedWeChatStatus(): WeChatStatus | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const value = JSON.parse(raw) as WeChatStatus
    if (typeof value.authed !== 'boolean' || typeof value.bridgeRunning !== 'boolean') return null
    return value
  } catch {
    return null
  }
}

/**
 * Remember WeChat Assistant status for the next connectors open.
 * @param status - non-secret Host status.
 */
export function setCachedWeChatStatus(status: WeChatStatus): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(status))
  } catch {
    // sessionStorage may be unavailable in some test hosts.
  }
}

/** Drop the Client status cache (tests / disconnect). */
export function clearCachedWeChatStatus(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
