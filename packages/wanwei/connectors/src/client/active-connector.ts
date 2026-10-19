/** Ids of connectors currently attached to the composer tool row. */
export type ActiveConnectorIds = readonly string[]

type Listener = () => void

let activeIds: string[] = []
const listeners = new Set<Listener>()

function notify(): void {
  for (const listener of listeners) listener()
}

/** Read all active composer connector ids (selection order).
 * @returns Connector catalog ids currently attached to the composer.
 */
export function getActiveConnectorIds(): ActiveConnectorIds {
  return activeIds
}

/** Read the first active composer connector id, or null when none.
 * @returns First selected catalog id, or null.
 */
export function getActiveConnectorId(): string | null {
  return activeIds[0] ?? null
}

/** Attach a connector (or clear all when `id` is null). Existing selections are kept.
 * @param id - Connector catalog id to attach, or null to clear every selection.
 */
export function setActiveConnectorId(id: string | null): void {
  if (id === null) {
    if (activeIds.length === 0) return
    activeIds = []
    notify()
    return
  }
  if (activeIds.includes(id)) return
  activeIds = [...activeIds, id]
  notify()
}

/** Toggle one connector in the composer selection set.
 * @param id - Connector catalog id to add or remove.
 */
export function toggleActiveConnectorId(id: string): void {
  if (activeIds.includes(id)) {
    activeIds = activeIds.filter(entry => entry !== id)
  } else {
    activeIds = [...activeIds, id]
  }
  notify()
}

/** Drop one connector from the composer selection without touching the others.
 * @param id - Connector catalog id to remove.
 */
export function removeActiveConnectorId(id: string): void {
  if (!activeIds.includes(id)) return
  activeIds = activeIds.filter(entry => entry !== id)
  notify()
}

/** Subscribe to active-connector changes for React `useSyncExternalStore`.
 * @param listener - Called after the selection set changes.
 * @returns Disposer.
 */
export function subscribeActiveConnector(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
