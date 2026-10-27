import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Composer knowledge toggle: whether retrieval is on and which libraries it searches. */
export interface RetrievalSelection {
  readonly enabled: boolean
  readonly ids: readonly number[]
}

/** Mutable selection source owned by one plugin `apply`. */
export interface RetrievalSelectionSource extends HostObservable<RetrievalSelection> {
  /** Publish a new selection; listeners run only when it changes. */
  set(next: RetrievalSelection): void
}

/**
 * Create the selection source; retrieval starts off with nothing selected.
 * @returns Observable selection with a setter.
 */
export function createRetrievalSelection(): RetrievalSelectionSource {
  let snapshot: RetrievalSelection = { enabled: false, ids: [] }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    set(next) {
      if (next.enabled === snapshot.enabled && next.ids.length === snapshot.ids.length
        && next.ids.every((id, index) => id === snapshot.ids[index])) return
      snapshot = { enabled: next.enabled, ids: [...next.ids] }
      for (const listener of [...listeners]) listener()
    },
  }
}
