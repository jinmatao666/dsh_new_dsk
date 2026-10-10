import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { NetworkState } from '../network-contract.ts'
import { resolveDeploymentFeatures } from '../deployment.ts'
import type { DeploymentFeatures } from '../deployment.ts'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** One observable mirror of the Host's durable deployment policy. */
export class NetworkController {
  private snapshot: NetworkState = { mode: 'internet', internalOrigins: [] }
  private readonly listeners = new Set<() => void>()
  private tail: Promise<unknown> = Promise.resolve()
  private features: DeploymentFeatures = resolveDeploymentFeatures(undefined)
  /** Observe one entry's visibility in the currently selected environment.
   * @param feature - Entry owned by the consuming plugin.
   * @returns Boolean observable sharing the committed deployment refresh.
   */
  visibility(feature: 'automations' | 'connectors'): HostObservable<boolean> {
    return { getSnapshot: () => this.features[this.snapshot.mode][feature], subscribe: this.subscribe }
  }
  constructor(private readonly connection: ConnectionHandle) {}
  /** Read the last synchronized Host state.
   * @returns Committed network state.
   */
  getSnapshot: () => NetworkState = () => this.snapshot
  /** Observe committed Host state changes.
   * @param listener - Callback invoked after synchronization.
   * @returns Subscription disposer.
   */
  subscribe: (listener: () => void) => (() => void) = (listener) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private async synchronize(value: NetworkState, features: DeploymentFeatures): Promise<void> {
    const native = (window as unknown as {
      __ZJUGIS_NATIVE_INVOKE__?: (command: string, args: unknown) => Promise<unknown>
    }).__ZJUGIS_NATIVE_INVOKE__
    if (native) await native('set_network_environment', { mode: value.mode, internalOrigins: value.internalOrigins })
    this.snapshot = value
    this.features = features
    for (const listener of this.listeners) {
      try { listener() }
      catch (error) { console.error('Deployment subscriber failed', error) }
    }
  }
  private request(operation: string, payload: unknown, signal?: AbortSignal): Promise<NetworkState> {
    const run = async () => {
      const result = await this.connection.rpc.call('/desktop-auth', operation, payload, signal)
      if (!result.ok) throw new Error(result.error.message)
      const value = result.value as { mode: unknown; internalOrigins: readonly string[]; features?: unknown }
      if (value.mode !== 'internet' && value.mode !== 'intranet') throw new Error('网络环境状态无效')
      const features = resolveDeploymentFeatures(value.features)
      await this.synchronize({ mode: value.mode, internalOrigins: value.internalOrigins }, features)
      return this.snapshot
    }
    const promise = this.tail.then(run)
    this.tail = promise.catch(() => {})
    return promise
  }
  /** Synchronize deployment policy from the Host.
   * @param signal - Optional cancellation signal for the request.
   * @returns Committed network state after native synchronization.
   */
  refresh: (signal?: AbortSignal) => Promise<NetworkState> = signal => this.request('network-get', {}, signal)
}
