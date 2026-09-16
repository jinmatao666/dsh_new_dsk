import type { ConnectionHandle, RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import type { AuthState } from '../contract.ts'

export type AuthView = AuthState | { state: 'checking' }

function unwrap(result: RpcResult<unknown>): AuthState {
  if (!result.ok) throw new Error(result.error.message)
  return result.value as AuthState
}

/** Browser authentication state over the Host-owned OneAPI channel. */
export class AuthController {
  private snapshot: AuthView = { state: 'checking' }
  private readonly listeners = new Set<() => void>()

  constructor(private readonly connection: ConnectionHandle) {}

  getSnapshot = (): AuthView => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async refresh(signal?: AbortSignal): Promise<AuthState> {
    const next = unwrap(await this.connection.rpc.call('/desktop-auth', 'status', {}, signal))
    if (!(next.state === 'offline' && this.snapshot.state === 'authenticated')) this.publish(next)
    return next
  }

  async login(username: string, password: string, signal?: AbortSignal): Promise<AuthState> {
    const next = unwrap(await this.connection.rpc.call(
      '/desktop-auth', 'login', { username, password }, signal,
    ))
    this.publish(next)
    return next
  }

  async logout(): Promise<AuthState> {
    const next = unwrap(await this.connection.rpc.call('/desktop-auth', 'logout', {}))
    this.publish(next)
    return next
  }

  fail(error: unknown): void {
    if (this.snapshot.state === 'authenticated') return
    this.publish({ state: 'offline', message: error instanceof Error ? error.message : String(error) })
  }

  private publish(next: AuthView): void {
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}
