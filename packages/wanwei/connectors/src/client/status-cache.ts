import type { DingTalkStatus } from './DingTalkPanel.tsx'

const STORAGE_KEY = 'wanwei.dingtalk.dwsStatus'

type Listener = () => void

let memory: DingTalkStatus | null = null
const listeners = new Set<Listener>()

function isStatus(value: unknown): value is DingTalkStatus {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.dwsInstalled === 'boolean'
    && typeof record.authed === 'boolean'
    && typeof record.skillInstalled === 'boolean'
    && (record.dwsVersion === null || typeof record.dwsVersion === 'string')
    && (record.hint === null || typeof record.hint === 'string')
}

/** Read the last known DingTalk status (memory, then localStorage).
 * @returns Cached status, or null when never loaded.
 */
export function getCachedDingTalkStatus(): DingTalkStatus | null {
  if (memory !== null) return memory
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isStatus(parsed)) return null
    memory = parsed
    return parsed
  } catch {
    // Corrupt or unavailable storage — treat as cold start.
    return null
  }
}

/** Remember status for instant reconnect UI and notify subscribers.
 * @param status - Latest Host status.
 */
export function setCachedDingTalkStatus(status: DingTalkStatus): void {
  memory = status
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(status))
  } catch {
    // Quota / private mode — memory cache still serves this session.
  }
  for (const listener of listeners) listener()
}

/** Clear persisted and in-memory status (after failed loads that should not stick).
 */
export function clearCachedDingTalkStatus(): void {
  memory = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore storage failures while clearing.
  }
  for (const listener of listeners) listener()
}

/** Subscribe to cache updates for React `useSyncExternalStore`.
 * @param listener - Called after the cache changes.
 * @returns Disposer.
 */
export function subscribeDingTalkStatusCache(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
