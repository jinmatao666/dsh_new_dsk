/** Native updater state shared by version settings, progress and completion notes. */
interface Snapshot {
  configured: boolean
  automatic: boolean
  currentVersion: string
  phase: string
  message: string
  received: number
  total: number
  completed?: { version: string; sha256: string; notes: string; dismissed: boolean } | null
}

/** Immutable update presentation; executable bytes remain in the native shell. */
export interface DesktopUpdateView {
  snapshot?: Snapshot
  error?: string | undefined
  pending: boolean
  progressOpen: boolean
}

type Invoke = (command: string, args: unknown) => Promise<unknown>

function snapshot(value: unknown): Snapshot {
  if (typeof value !== 'object' || value === null || !('configured' in value) || typeof value.configured !== 'boolean'
    || !('automatic' in value) || typeof value.automatic !== 'boolean' || !('currentVersion' in value) || typeof value.currentVersion !== 'string'
    || !('phase' in value) || typeof value.phase !== 'string' || !('message' in value) || typeof value.message !== 'string'
    || !('received' in value) || typeof value.received !== 'number' || !Number.isFinite(value.received) || value.received < 0
    || !('total' in value) || typeof value.total !== 'number' || !Number.isFinite(value.total) || value.total < 0) {
    throw new Error('Invalid native update status')
  }
  if ('completed' in value && value.completed !== null && value.completed !== undefined) {
    const completed = value.completed
    if (typeof completed !== 'object' || !('version' in completed) || typeof completed.version !== 'string'
      || !('sha256' in completed) || typeof completed.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(completed.sha256)
      || !('notes' in completed) || typeof completed.notes !== 'string'
      || !('dismissed' in completed) || typeof completed.dismissed !== 'boolean') {
      throw new Error('Invalid completed update status')
    }
  }
  return value as Snapshot
}

/** Share native status across settings navigation without changing native confirmations or install guards. */
export class DesktopUpdateController {
  private view: DesktopUpdateView = { pending: false, progressOpen: false }
  private readonly listeners = new Set<() => void>()
  private alive = false
  private revision = 0

  constructor(private readonly invoke: Invoke | undefined) {}

  /** Whether the desktop bridge is available. */
  get available(): boolean { return this.invoke !== undefined }

  /** Current immutable state for external-store subscribers. */
  getSnapshot = (): DesktopUpdateView => this.view

  /** Subscribe until the returned disposer runs. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Start one serial polling loop and suppress late responses after disposal.
   * @returns Plugin-lifetime disposer.
   */
  start(): () => void {
    this.alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      await this.refresh()
      if (this.alive && this.available) timer = setTimeout(() => { void poll() }, 1000)
    }
    void poll()
    return () => { this.alive = false; this.revision++; clearTimeout(timer); this.listeners.clear() }
  }

  /** Change dialog visibility without cancelling the native download.
   * @param open - Whether progress is shown.
   */
  showProgress = (open: boolean): void => { this.publish({ ...this.view, progressOpen: open }) }

  /** Ask the native shell to check, retaining download and installation confirmations. */
  check = async (): Promise<void> => { await this.perform('desktop_update_check', {}) }

  /** Persist the native automatic-check preference.
   * @param enabled - Whether startup and periodic checks are enabled.
   */
  setAutomatic = async (enabled: boolean): Promise<void> => { await this.perform('desktop_update_automatic', { enabled }) }

  /** Persist dismissal of the installed package's release notes. */
  dismissCompleted = async (): Promise<void> => {
    const completed = this.view.snapshot?.completed
    if (completed) await this.perform('desktop_update_dismiss', { sha256: completed.sha256 })
  }

  private publish(next: DesktopUpdateView): void {
    if (!this.alive) return
    this.view = next
    this.listeners.forEach((listener) => { listener() })
  }

  private async refresh(): Promise<void> {
    if (this.invoke === undefined) return
    const revision = ++this.revision
    try {
      const next = snapshot(await this.invoke('desktop_update_status', {}))
      if (revision !== this.revision) return
      const entering = next.phase !== this.view.snapshot?.phase && ['downloading', 'installing'].includes(next.phase)
      this.publish({ ...this.view, snapshot: next, progressOpen: entering || this.view.progressOpen })
    } catch (error) {
      if (revision === this.revision) this.publish({ ...this.view, error: String(error) })
    }
  }

  private async perform(command: string, args: unknown): Promise<void> {
    if (!this.alive || this.invoke === undefined || this.view.pending) return
    this.publish({ ...this.view, pending: true, error: undefined })
    try { await this.invoke(command, args); await this.refresh() }
    catch (error) { this.publish({ ...this.view, error: String(error) }) }
    finally { this.publish({ ...this.view, pending: false }) }
  }
}
