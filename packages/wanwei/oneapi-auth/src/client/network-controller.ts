import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { NetworkEnvironment, NetworkState } from '../network-contract.ts'

/** One observable mirror of the Host's durable deployment policy. */
export class NetworkController {
  private snapshot: NetworkState = { mode: 'internet', internalOrigins: [] }
  private readonly listeners = new Set<() => void>()
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly connection: ConnectionHandle) {}
  getSnapshot = (): NetworkState => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private async synchronize(value: NetworkState): Promise<void> {
    const native = (window as unknown as {
      __ZJUGIS_NATIVE_INVOKE__?: (command: string, args: unknown) => Promise<unknown>
    }).__ZJUGIS_NATIVE_INVOKE__
    if (native) await native('set_network_environment', { mode: value.mode, internalOrigins: value.internalOrigins })
    this.snapshot = value
    for (const listener of this.listeners) listener()
  }
  private request(operation: string, payload: unknown, signal?: AbortSignal): Promise<NetworkState> {
    const run = async () => {
      const result = await this.connection.rpc.call('/desktop-auth', operation, payload, signal)
      if (!result.ok) throw new Error(result.error.message)
      const value = result.value as NetworkState
      if (value.mode !== 'internet' && value.mode !== 'intranet') throw new Error('网络环境状态无效')
      await this.synchronize(value)
      return value
    }
    const promise = this.tail.then(run)
    this.tail = promise.catch(() => {})
    return promise
  }
  refresh = (signal?: AbortSignal): Promise<NetworkState> => this.request('network-get', {}, signal)
  setMode = (mode: NetworkEnvironment): Promise<NetworkState> => this.request('network-set', { mode })
}
