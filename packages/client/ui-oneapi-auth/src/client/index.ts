/** Browser half of the desktop authentication gate. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientRequest, ConnectionHandle, RpcMessage, RpcResult, ServerResponse } from '@deepseek-ai/dsh-client-connection/client'
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
  // Persist prompts and rejected prompt admissions without ever sending the
  // assistant response or image bytes. The host-side RPC keeps the OneAPI key
  // out of the browser and forwards the event to the admin-only event store.
  const pending = new Map<string, { question: string; sessionId?: string }>()
  const report = (payload: Record<string, unknown>) => { void connection.rpc.call('/desktop-auth', 'report-question', payload).catch(() => undefined) }
  const observedApi = connection.api as unknown as { subscribeEnvelopes?: (listener: (batch: readonly RpcMessage[]) => void) => () => void }
  const unsubscribeQuestions = observedApi.subscribeEnvelopes?.((batch: readonly RpcMessage[]) => {
    for (const message of batch) {
      if (message.type === 'client-request' && message.method === 'session.prompt') {
        const request = message as ClientRequest
        const payload = (request.payload ?? {}) as { sessionId?: unknown; content?: unknown }
        const content = Array.isArray(payload.content) ? payload.content : []
        const question = content.filter((part): part is { type: 'text'; text: string } => typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string').map(part => part.text).join('\n').trim()
        if (question !== '') {
          const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : undefined
          const record = sessionId === undefined ? { question } : { question, sessionId }
          pending.set(String(request.rpcId), record)
          report({ ...record, requestId: String(request.rpcId), status: 'submitted' })
        }
      } else if (message.type === 'server-response') {
        const response = message as ServerResponse
        const request = pending.get(String(response.rpcId))
        if (request !== undefined) {
          pending.delete(String(response.rpcId))
          if (!response.result.ok) report({ ...request, requestId: String(response.rpcId), status: 'failed', error: response.result.error.message })
        }
      }
    }
  })
  ctx.effect(() => () => { unsubscribeQuestions?.(); pending.clear() }, 'ui-oneapi-auth: question reporting')
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
