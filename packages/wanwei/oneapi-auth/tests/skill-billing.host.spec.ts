import { afterEach, expect, it, vi } from 'vitest'
import { createSkillExecutor } from '../src/skill-billing.ts'

afterEach(() => vi.unstubAllGlobals())
function harness(cost = 200) {
  const calls: { path: string; body?: Record<string, unknown>; auth: string | null }[] = []
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ path, body, auth: new Headers(init.headers).get('authorization') })
    if (path.includes('/quote?')) return Response.json({ success: true, data: { rule: { version: 1, enabled: true, unit_quota: cost } } })
    if (path.endsWith('/tasks')) return Response.json({ success: true, data: { id: 'task-1' }, task_token: 'task-only' })
    return Response.json({ success: true })
  }))
  let dispose = () => {}
  const hooks = vi.fn()
  const ctx = { on: hooks, inject: hooks, get: () => undefined, effect: (run: () => () => void) => { dispose = run() } }
  const executor = createSkillExecutor(ctx as never, 'https://platform.test', async () => 'user')
  const abort = new AbortController()
  const execute = vi.fn(async () => ({ succeeded: true, value: 'converted.pdf' }))
  const operation = { operationId: 'convert-001', skillName: 'pdf-convert', signal: abort.signal, execute }
  return { executor, operation, execute, abort, calls, hooks, dispose: () => dispose() }
}
it('does not subscribe to skill loads, pre-step, tools or turn completion', () => {
  const h = harness()
  try { expect(h.hooks).not.toHaveBeenCalled(); expect(h.calls).toEqual([]) } finally { h.dispose() }
})
it('reserves before concrete work and settles its explicit success', async () => {
  const h = harness()
  h.execute.mockImplementation(async () => {
    expect(h.calls.at(-1)?.path).toMatch(/tasks$/)
    expect(h.calls.some(c => c.path.endsWith('/result'))).toBe(false)
    return { succeeded: true, value: 'converted.pdf' }
  })
  try {
    await expect(h.executor.run(h.operation)).resolves.toMatchObject({ succeeded: true })
    expect(h.calls.at(-1)).toMatchObject({ auth: 'Bearer task-only', body: { status: 'succeeded' } })
    await expect(h.executor.run(h.operation)).rejects.toThrow('已经结束')
    expect(h.execute).toHaveBeenCalledTimes(1)
  } finally { h.dispose() }
})
it('releases explicit business failure even if the conversation could continue', async () => {
  const h = harness()
  h.execute.mockResolvedValue({ succeeded: false, value: '' })
  try { await h.executor.run(h.operation); expect(h.calls.at(-1)?.body).toEqual({ status: 'failed' }) } finally { h.dispose() }
})
it('releases on execution exception', async () => {
  const h = harness()
  h.execute.mockRejectedValue(new Error('converter failed'))
  try {
    await expect(h.executor.run(h.operation)).rejects.toThrow('converter failed')
    expect(h.calls.at(-1)?.body).toEqual({ status: 'failed' })
  } finally { h.dispose() }
})
it('releases when cancelled during work', async () => {
  const h = harness()
  h.execute.mockImplementation(async () => { h.abort.abort(); return { succeeded: true, value: '' } })
  try {
    await expect(h.executor.run(h.operation)).rejects.toThrow()
    expect(h.calls.at(-1)?.body).toEqual({ status: 'cancelled' })
  } finally { h.dispose() }
})
it('executes free operations without creating a reservation', async () => {
  const h = harness(0)
  try {
    await h.executor.run(h.operation)
    expect(h.calls).toHaveLength(1)
    expect(h.execute).toHaveBeenCalledOnce()
  } finally { h.dispose() }
})
it('does not execute when funds are insufficient', async () => {
  const h = harness()
  vi.mocked(fetch).mockImplementationOnce(async () => Response.json({
    success: true, data: { rule: { version: 1, enabled: true, unit_quota: 200 } },
  }))
  vi.mocked(fetch).mockImplementationOnce(async () => Response.json({ success: false, code: 'INSUFFICIENT_CREDITS' }, { status: 403 }))
  try {
    await expect(h.executor.run(h.operation)).rejects.toMatchObject({ code: 'QUOTA' })
    expect(h.execute).not.toHaveBeenCalled()
  } finally { h.dispose() }
})
it('coalesces concurrent retries of one concrete operation', async () => {
  const h = harness()
  try {
    await Promise.all([h.executor.run(h.operation), h.executor.run(h.operation)])
    expect(h.execute).toHaveBeenCalledOnce()
    expect(h.calls.filter(c => c.path.endsWith('/tasks'))).toHaveLength(1)
  } finally { h.dispose() }
})
