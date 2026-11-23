// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { connectForumAnalysis } from '../src/client/analysis-bridge.ts'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function fixture() {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const post = vi.spyOn(frame.contentWindow!, 'postMessage')
  const call = vi.fn().mockResolvedValue({ ok: true, value: { text: '分析结果', model: 'current', provider: 'server' } })
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const payload: unknown = JSON.parse(init.body as string)
    const result: unknown = await call('/desktop-forum', 'analyze', payload, init.signal)
    return new Response(JSON.stringify({ type: 'delta', text: '分析' }) + '\n' + JSON.stringify({ type: 'result', result }) + '\n')
  }))
  const dispose = connectForumAnalysis(frame, 'https://forum.test',
    async () => ({ provider: 'server', model: 'selector-model' }))
  const emit = (type: string, origin = 'https://forum.test', source: MessageEventSource | null = frame.contentWindow, extra = {}) => {
    window.dispatchEvent(new MessageEvent('message', { origin, source, data: { channel: 'wanwei-forum-ai-v1', type, id: 'request-1', ...extra } }))
  }
  return { frame, post, call, dispose, emit }
}

it('accepts only the configured origin and iframe, then returns the Host answer without credentials', async () => {
  const h = fixture()
  try {
    h.emit('analyze', 'https://evil.test')
    h.emit('analyze', 'https://forum.test', window)
    expect(h.call).not.toHaveBeenCalled()
    h.emit('hello')
    expect(h.post).toHaveBeenLastCalledWith({ channel: 'wanwei-forum-ai-v1', type: 'ready', id: 'request-1' }, 'https://forum.test')
    h.emit('analyze', undefined, undefined, { payload: { question: '要点' } })
    await vi.waitFor(() => { expect(h.post).toHaveBeenLastCalledWith({ channel: 'wanwei-forum-ai-v1', type: 'result', id: 'request-1', value: { text: '分析结果', model: 'current', provider: 'server' } }, 'https://forum.test') })
    expect(h.call).toHaveBeenCalledWith('/desktop-forum', 'analyze', { question: '要点', selection: { provider: 'server', model: 'selector-model' } }, expect.any(AbortSignal))
  } finally { h.dispose() }
})

it('cancels by request id and ignores late answers after navigation or disposal', async () => {
  const h = fixture()
  let resolve!: (value: unknown) => void
  h.call.mockImplementation(() => new Promise((done) => { resolve = done }))
  h.emit('analyze')
  await vi.waitFor(() => { expect(h.call).toHaveBeenCalledTimes(1) })
  const signal = h.call.mock.calls[0]![3] as AbortSignal
  h.emit('cancel', undefined, undefined, { id: 'other' })
  expect(signal.aborted).toBe(false)
  h.frame.dispatchEvent(new Event('load'))
  expect(signal.aborted).toBe(true)
  h.dispose()
  resolve({ ok: true, value: { text: 'late' } })
  await Promise.resolve()
  expect(h.post).not.toHaveBeenCalled()
  h.emit('hello')
  expect(h.post).not.toHaveBeenCalled()
})

it('ignores the removed quote operation and overrides an iframe-supplied model', async () => {
  const h = fixture()
  try {
    h.emit('quote', undefined, undefined, { payload: { question: '要点', action: 'report' } })
    await Promise.resolve()
    expect(h.call).not.toHaveBeenCalled()
    h.emit('analyze', undefined, undefined, { payload: { selection: { provider: 'evil', model: 'other' } } })
    await vi.waitFor(() => { expect(h.call).toHaveBeenCalledWith('/desktop-forum', 'analyze', {
      selection: { provider: 'server', model: 'selector-model' },
    }, expect.any(AbortSignal)) })
  } finally { h.dispose() }
})
