import { afterEach, expect, it, vi } from 'vitest'
import { installSkillCallBilling } from '../src/skill-billing.ts'
afterEach(() => vi.unstubAllGlobals())
it('charges separate successful skill tool calls separately, never slash injection or failed calls', async () => {
  type Result = { isError: boolean; value?: string }
  type Call = { name: string; arguments: { name: string }; agent?: { session: { id: string } }; signal: AbortSignal; callId: string }
  type Handler = (exec: Call, next: () => Promise<Result>) => Promise<Result>
  let dispatch: Handler
  const statuses: string[] = []
  let reserves = 0
  const reservedBodies: unknown[] = []
  const hooks: string[] = []
  let dispose = () => {}
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes('/quote?')) return Response.json({ success: true, data: { rule: { id: 'cp_skill', enabled: true, version: 1, unit_quota: 200 } } })
    if (url.endsWith('/tasks')) {
      reserves++; reservedBodies.push(JSON.parse(String(init.body)))
      return Response.json({ success: true, data: { id: 'task-'+reserves }, task_token: 'capability' })
    }
    statuses.push(JSON.parse(String(init.body)).status)
    return Response.json({ success: true })
  }))
  const ctx = {
    on: vi.fn(),
    get: () => undefined,
    effect: (run: () => () => void) => { dispose = run() },
    inject: (_: unknown, mount: (scope: { on: (name: string, handler: Handler) => void }) => void) => mount({
      on: (name: string, handler: Handler) => { hooks.push(name); dispatch = handler },
    }),
  }
  installSkillCallBilling(ctx as never, 'https://platform.test', async () => 'payer')
  const base = { name: 'skill', arguments: { name: 'pdf' }, agent: { session: { id: 'session' } }, signal: new AbortController().signal }
  const trackTurn = ctx.on.mock.calls.find(([name]) => name === 'agent/request')?.[1] as
    (payload: { agent: typeof base.agent; turn: number }, next: () => Promise<object>) => Promise<object>
  await trackTurn({ agent: base.agent, turn: 4 }, async () => ({}))
  try {
    expect(hooks).toEqual(['tools/execute'])
    expect(reserves).toBe(0)
    await dispatch!({ ...base, callId: 'call-1' }, async () => ({ isError: false, value: 'instructions' }))
    await dispatch!({ ...base, callId: 'call-2' }, async () => ({ isError: false, value: 'instructions' }))
    expect(reserves).toBe(2)
    expect(reservedBodies[0]).toMatchObject({ session_id: 'session', turn_id: 4 })
    expect(statuses).toEqual(['succeeded', 'succeeded'])
    const failed = await dispatch!({ ...base, callId: 'call-3' }, async () => ({ isError: true }))
    expect(failed.isError).toBe(true)
    expect(statuses).toEqual(['succeeded', 'succeeded', 'failed'])
    const next = vi.fn(async () => ({ isError: false }))
    await dispatch!({ ...base, name: 'read_file', callId: 'other' }, next)
    await dispatch!({ name: base.name, arguments: base.arguments, signal: base.signal, callId: 'manual' }, next)
    expect(reserves).toBe(3)
  } finally { dispose() }
})
