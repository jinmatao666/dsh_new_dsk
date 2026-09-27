import type { ConnectionHandle, RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import type { AuthState } from '../contract.ts'

/** Authentication state including the initial status check. */
export type AuthView = AuthState | { state: 'checking' }

function unwrap(result: RpcResult<unknown>): AuthState {
  if (!result.ok) throw new Error(result.error.message)
  return result.value as AuthState
}

/** Browser authentication state over the Host-owned OneAPI channel. */
export class AuthController {
  private snapshot: AuthView = { state: 'checking' }
  private readonly listeners = new Set<() => void>()
  private authRevision = 0
  private refreshRevision = 0
  private mutations = 0

  constructor(private readonly connection: ConnectionHandle) {}

  /** Current immutable view for external-store subscribers. */
  getSnapshot = (): AuthView => this.snapshot

  /** Subscribe until the returned disposer is called. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Refresh status without publishing obsolete responses.
 * @param signal - Optional cancellation signal.
 * @returns Host status, even when superseded and not published.
 */
  async refresh(signal?: AbortSignal): Promise<AuthState> {
    const authRevision = this.authRevision
    const refreshRevision = ++this.refreshRevision
    const startedDuringMutation = this.mutations > 0
    const obsolete = (): boolean => signal?.aborted === true || startedDuringMutation || this.mutations > 0
      || authRevision !== this.authRevision || refreshRevision !== this.refreshRevision
    try {
      const next = unwrap(await this.connection.rpc.call('/desktop-auth', 'status', {}, signal))
      if (!obsolete() && !(next.state === 'offline' && this.snapshot.state === 'authenticated')) this.publish(next)
      return next
    } catch (error) {
      if (obsolete()) throw new DOMException('Authentication refresh superseded', 'AbortError')
      throw error
    }
  }

  /** Authenticate; only the newest uncancelled mutation updates the view.
 * @param username - Account name.
 * @param password - Password forwarded only to the Host.
 * @param signal - Optional cancellation signal.
 * @returns Host authentication result.
 */
  async login(username: string, password: string, signal?: AbortSignal): Promise<AuthState> {
    const revision = ++this.authRevision
    this.mutations++
    try {
      const next = unwrap(await this.connection.rpc.call(
        '/desktop-auth', 'login', { username, password }, signal,
      ))
      if (revision === this.authRevision && !signal?.aborted) this.publish(next)
      return next
    } finally {
      this.mutations--
    }
  }

  /** End the Host session; only the newest mutation updates the view.
 * @returns Host authentication result.
 */
  async logout(): Promise<AuthState> {
    const revision = ++this.authRevision
    this.mutations++
    try {
      const next = unwrap(await this.connection.rpc.call('/desktop-auth', 'logout', {}))
      if (revision === this.authRevision) this.publish(next)
      return next
    } finally {
      this.mutations--
    }
  }

  /** Show failures outside authenticated state; ignore cancellation.
 * @param error - Failed operation.
 */
  fail(error: unknown): void {
    if (error instanceof Error && error.name === 'AbortError') return
    if (this.snapshot.state === 'authenticated') return
    this.publish({ state: 'offline', message: error instanceof Error ? error.message : String(error) })
  }

  private publish(next: AuthView): void {
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}
