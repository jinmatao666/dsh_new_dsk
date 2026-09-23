/** A completed review is new only when its recorded result changes after the first observation. */
export type ReviewRecord = {
  id?: unknown
  owner?: unknown
  name?: unknown
  version?: unknown
  review_status?: unknown
  reviewed_at?: unknown
  submitted_at?: unknown
}

export type ReviewAttention = {
  known: Record<string, string>
  unread: Record<string, 'approved' | 'rejected'>
}

const storageKey = 'dsh.marketplace.review-attention.v1'
const listeners = new Set<() => void>()
let current: ReviewAttention | null | undefined

function recordKey(record: ReviewRecord): string {
  return JSON.stringify([record.owner ?? '', record.id ?? record.name ?? ''])
}

function resultKey(record: ReviewRecord): string {
  return JSON.stringify([
    record.review_status, record.version, record.reviewed_at,
    record.submitted_at,
  ])
}

/** Compare the current owner review list with the last observed list.
 * @param previous - The persisted observation, or null before the first successful fetch.
 * @param records - The owner review records returned by the server.
 * @returns Updated observations and unseen completed results.
 */
export function observeReviews(previous: ReviewAttention | null, records: readonly ReviewRecord[]): ReviewAttention {
  const known: Record<string, string> = {}
  let unread: ReviewAttention['unread'] = { ...previous?.unread }
  for (const record of records) {
    if (record.review_status !== 'pending' && record.review_status !== 'approved' && record.review_status !== 'rejected') continue
    const key = recordKey(record)
    const result = resultKey(record)
    known[key] = result
    if (previous !== null && previous.known[key] !== result) {
      if (record.review_status === 'approved' || record.review_status === 'rejected') unread[key] = record.review_status
      else unread = Object.fromEntries(Object.entries(unread).filter(([entryKey]) => entryKey !== key))
    }
  }
  unread = Object.fromEntries(Object.entries(unread).filter(([key]) => known[key] !== undefined))
  return { known, unread }
}

/** Clear only the completed result category the user has opened.
 * @param state - Current review attention.
 * @param status - The result filter viewed by the user.
 * @returns Attention with that category cleared.
 */
export function clearSeenReviews(state: ReviewAttention, status: 'approved' | 'rejected'): ReviewAttention {
  const unread = Object.fromEntries(Object.entries(state.unread).filter(([, value]) => value !== status))
  return { ...state, unread }
}

function readStored(): ReviewAttention | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || !('known' in parsed) || !('unread' in parsed)
      || typeof parsed.known !== 'object' || parsed.known === null
      || typeof parsed.unread !== 'object' || parsed.unread === null) return null
    return parsed as ReviewAttention
  } catch {
    return null
  }
}

function publish(next: ReviewAttention): void {
  if (JSON.stringify(current) === JSON.stringify(next)) return
  current = next
  try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* In-memory attention remains available. */ }
  for (const listener of listeners) listener()
}

/** Return a stable snapshot for useSyncExternalStore.
 * @returns Persisted review attention, or null before the first successful fetch.
 */
export function reviewAttentionSnapshot(): ReviewAttention | null {
  if (current === undefined) current = readStored()
  return current
}

/** Subscribe to review attention changes in this WebView.
 * @param listener - Called after the stored result list or read state changes.
 * @returns A listener disposer.
 */
export function subscribeReviewAttention(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Record a successfully loaded owner review list.
 * @param records - The records returned by the authenticated server.
 */
export function recordReviewList(records: readonly ReviewRecord[]): void {
  publish(observeReviews(reviewAttentionSnapshot(), records))
}

/** Mark one reviewed result category as seen.
 * @param status - The approved or rejected filter the user opened.
 */
export function markReviewsSeen(status: 'approved' | 'rejected'): void {
  const state = reviewAttentionSnapshot()
  if (state === null || !Object.values(state.unread).includes(status)) return
  publish(clearSeenReviews(state, status))
}
