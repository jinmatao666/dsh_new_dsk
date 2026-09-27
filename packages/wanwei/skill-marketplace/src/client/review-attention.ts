/** Review fields returned by the Wanwei personal-skill API. */
export type ReviewRecord = {
  id?: unknown
  owner?: unknown
  name?: unknown
  version?: unknown
  review_status?: unknown
  reviewed_at?: unknown
  submitted_at?: unknown
}

/** Persisted review baseline and unread results. */
export type ReviewAttention = {
  known: Record<string, string>
  unread: Record<string, 'approved' | 'rejected'>
}

const storageKey = 'dsh.marketplace.review-attention.v1'
const listeners = new Set<() => void>()
let current: ReviewAttention | null | undefined

function keyOf(record: ReviewRecord): string {
  return JSON.stringify([record.owner ?? '', record.id ?? record.name ?? ''])
}

function resultOf(record: ReviewRecord): string {
  return JSON.stringify([record.review_status, record.version, record.reviewed_at, record.submitted_at])
}

/**
 * Compare a fresh review list with the last observed state.
 * @param previous - Stored review baseline, or null on first observation.
 * @param records - Current owner review records.
 * @returns Updated baseline and unread results.
 */
export function observeReviews(previous: ReviewAttention | null, records: readonly ReviewRecord[]): ReviewAttention {
  const known: Record<string, string> = {}
  let unread = { ...previous?.unread }
  for (const record of records) {
    if (record.review_status !== 'pending' && record.review_status !== 'approved' && record.review_status !== 'rejected') continue
    const key = keyOf(record)
    const result = resultOf(record)
    known[key] = result
    if (previous !== null && previous.known[key] !== result) {
      if (record.review_status === 'approved' || record.review_status === 'rejected') unread[key] = record.review_status
      else unread = Object.fromEntries(Object.entries(unread).filter(([candidate]) => candidate !== key))
    }
  }
  unread = Object.fromEntries(Object.entries(unread).filter(([key]) => known[key] !== undefined))
  return { known, unread }
}

/**
 * Dismiss one class of review results after the user opens its filter.
 * @param state - Current review attention state.
 * @param status - Result status the user viewed.
 * @returns State with matching unread results removed.
 */
export function clearSeenReviews(state: ReviewAttention, status: 'approved' | 'rejected'): ReviewAttention {
  return {
    ...state,
    unread: Object.fromEntries(Object.entries(state.unread).filter(([, value]) => value !== status)),
  }
}

function readStored(): ReviewAttention | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw === null) return null
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || !('known' in value) || !('unread' in value)
      || typeof value.known !== 'object' || value.known === null
      || typeof value.unread !== 'object' || value.unread === null) return null
    return value as ReviewAttention
  } catch { return null }
}

/**
 * Return the current attention state, loading local storage on first access.
 * @returns Current state or null before the first review list arrives.
 */
export function reviewAttentionSnapshot(): ReviewAttention | null {
  if (current === undefined) current = readStored()
  return current
}

/**
 * Subscribe to changes in the review attention state.
 * @param listener - Callback to run after a change.
 * @returns Unsubscribe callback.
 */
export function subscribeReviewAttention(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function publish(next: ReviewAttention): void {
  if (JSON.stringify(current) === JSON.stringify(next)) return
  current = next
  try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* In-memory state remains available. */ }
  for (const listener of listeners) listener()
}

/**
 * Record the latest review list and publish newly changed results.
 * @param records - Current owner review records.
 */
export function recordReviewList(records: readonly ReviewRecord[]): void {
  publish(observeReviews(reviewAttentionSnapshot(), records))
}

/**
 * Clear unread results for a status that the user has viewed.
 * @param status - Result status the user viewed.
 */
export function markReviewsSeen(status: 'approved' | 'rejected'): void {
  const state = reviewAttentionSnapshot()
  if (state !== null && Object.values(state.unread).includes(status)) publish(clearSeenReviews(state, status))
}
