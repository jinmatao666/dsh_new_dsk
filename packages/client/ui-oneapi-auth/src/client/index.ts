/** Browser half of the desktop authentication gate. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle, RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { AuthGate } from './AuthGate.tsx'
import { AccountSection } from './AccountSection.tsx'
import type { AuthState } from '../contract.ts'

/** Required browser services. */
export const inject = ['slots', 'connection']

function value(result: RpcResult<unknown>): unknown {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Register the full-window login gate in the additive shell overlay slot. */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const listeners = new Set<(state: AuthState) => void>()
  const publish = (state: AuthState): AuthState => { for (const listener of listeners) listener(state); return state }
  const injected = {
    status: async (signal?: AbortSignal) => publish(value(await connection.rpc.call('/desktop-auth', 'status', {}, signal)) as AuthState),
    login: async (username: string, password: string, signal?: AbortSignal) => publish(value(await connection.rpc.call('/desktop-auth', 'login', { username, password }, signal)) as AuthState),
    logout: async () => publish(value(await connection.rpc.call('/desktop-auth', 'logout', {})) as AuthState),
    subscribe: (listener: (state: AuthState) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'oneapi-auth',
    order: -1000,
    inject: () => injected,
  }, AuthGate))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'account',
    order: 40,
    label: '账户设置',
    inject: () => injected,
  }, AccountSection))
}
