import { describe, expect, it, vi } from 'vitest'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { requestPreviewText } from '../src/client/preview-model.ts'

function bench() {
  let entries: unknown[] = []
  const listeners = new Set<() => void>()
  const abandon = vi.fn()
  const prompt = vi.fn(async () => ({ ok: true }))
  const sessions = { binding: () => ({
    session: { getSnapshot: () => ({ running: false }), beginSubmission: () => ({ requestId: 'edit-request', abandon }), prompt },
    eventSource: {
      getSnapshot: () => ({ entries }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    },
  }) } as unknown as ISessions
  const append = (type: string, data: unknown) => { entries = [...entries, { type: 'event', event: { type, data } }]; listeners.forEach(listener => listener()) }
  return { sessions, append, abandon, listeners, prompt }
}

describe('preview model response correlation', () => {
  it('uses the submitted request identity and waits for its complete turn', async () => {
    const view = bench()
    const pending = requestPreviewText(view.sessions, 'session' as Parameters<ISessions['binding']>[0], 'polish', new AbortController().signal)
    view.append('turn/start', { turn: 1 })
    view.append('user/message', { source: { kind: 'user', rpcId: 'other-request' } })
    view.append('assistant/message', { turn: 1, message: { content: [{ type: 'text', text: 'wrong response' }] } })
    view.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    view.append('turn/start', { turn: 2 })
    view.append('user/message', { source: { kind: 'user', rpcId: 'edit-request' } })
    view.append('assistant/message', { turn: 2, message: { content: [{ type: 'text', text: 'edited text' }] } })
    expect(view.listeners.size).toBe(1)
    view.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    await expect(pending).resolves.toBe('edited text')
    expect(view.listeners.size).toBe(0)
    expect(view.prompt).toHaveBeenCalledWith([{ type: 'text', text: 'polish' }], 'queue', expect.any(AbortSignal), 'edit-request')
  })
  it('stops observing when a workspace is disposed', async () => {
    const view = bench(); const controller = new AbortController()
    const pending = requestPreviewText(view.sessions, 'session' as Parameters<ISessions['binding']>[0], 'polish', controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow('取消')
    expect(view.listeners.size).toBe(0)
    expect(view.abandon).toHaveBeenCalledOnce()
  })
})
