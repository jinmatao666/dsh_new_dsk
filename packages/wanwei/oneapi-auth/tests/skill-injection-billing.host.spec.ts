import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { installSkillInjectionBilling } from '../src/skill-injection-billing.ts'

afterEach(() => vi.unstubAllGlobals())

async function fixture(cost = 200) {
  const root = await mkdtemp(join(tmpdir(), 'injected-skill-billing-'))
  const ctx = new Context()
  const calls: { path: string; body: Record<string, unknown> }[] = []
  let insufficient = false
  let enabled = true
  ctx.provide('wanweiNetworkPolicy', { getSnapshot: () => ({ billing: { enabled } }) } as never)
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
    calls.push({ path, body })
    if (path.includes('/quote?')) return Response.json({ success: true, data: { rule: { enabled: true, version: 1, unit_quota: cost } } })
    if (path.endsWith('/tasks')) return insufficient
      ? Response.json({ success: false, code: 'INSUFFICIENT_CREDITS' }, { status: 403 })
      : Response.json({ success: true, data: { id: 'task-' + calls.length }, task_token: 'capability' })
    return Response.json({ success: true })
  }))
  const file = join(root, 'cordis.yml')
  await writeFile(file, '- name: injection-billing-test\n')
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import() {
    return { name: 'injection-billing-test', apply(scope: Context) {
      installSkillInjectionBilling(scope, 'https://platform.test', async () => 'account')
    } }
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(file).href } })
  await ctx.loader.await()
  const session = { id: 'session-a' }
  const emit = (type: string, data: object) => ctx.emit('session/event', session as never, { type, data } as never)
  emit('turn/start', { turn: 1 })
  const message = { id: 'load-1', role: 'user', content: [{ type: 'text', text: 'Loaded skill instructions' }],
    source: { kind: 'skill-invocation', form: 'instructions', name: 'pdf' } }
  const inject = () => emit('user/message', message)
  const stream = async (next: () => AsyncIterable<unknown>, messages: object[] = [message]) => {
    const value = ctx.waterfall('llm/stream', { sessionId: session.id, turnId: 1, messages } as never, next as never)
    const chunks = []
    for await (const chunk of value) chunks.push(chunk)
    return chunks
  }
  const success = async function* () { yield { type: 'text-delta', index: 0, text: 'answer' } }
  const dispose = async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  return { ctx, calls, inject, stream, success, message, dispose, deny: () => { insufficient = true }, disable: () => { enabled = false } }
}

it('charges accepted injected content once, preserves its stream, and ignores subsequent history reuse', async () => {
  const h = await fixture()
  try {
    h.inject(); expect(h.calls).toHaveLength(0)
    expect(await h.stream(h.success)).toEqual([{ type: 'text-delta', index: 0, text: 'answer' }])
    expect(h.calls.filter(c => c.path.endsWith('/tasks'))).toHaveLength(1)
    expect(h.calls.find(c => c.path.endsWith('/tasks'))?.body).toMatchObject({ session_id: 'session-a', turn_id: 1 })
    expect(h.calls.at(-1)?.body).toEqual({ status: 'succeeded' })
    await h.stream(h.success)
    expect(h.calls.filter(c => c.path.endsWith('/tasks'))).toHaveLength(1)
  } finally { await h.dispose() }
})

it('does not charge instructions excluded from the model request', async () => {
  const h = await fixture()
  try { h.inject(); await h.stream(h.success, []); expect(h.calls).toHaveLength(0) } finally { await h.dispose() }
})

it('refunds a failed model entry and allows a successful retry without charging twice', async () => {
  const h = await fixture()
  try {
    h.inject()
    await expect(h.stream(async function* () { throw new Error('connection failed') })).rejects.toThrow('connection failed')
    expect(h.calls.at(-1)?.body).toEqual({ status: 'failed' })
    await h.stream(h.success)
    expect(h.calls.filter(c => c.body.status === 'succeeded')).toHaveLength(1)
    const reservations = h.calls.filter(c => c.path.endsWith('/tasks'))
    expect(reservations).toHaveLength(2)
    expect(reservations[0]?.body.request_id).not.toBe(reservations[1]?.body.request_id)
  } finally { await h.dispose() }
})

it('stops before contacting the model when skill credits are insufficient', async () => {
  const h = await fixture()
  try {
    h.inject(); h.deny()
    const provider = vi.fn(h.success)
    await expect(h.stream(provider)).rejects.toThrow('积分不足')
    expect(provider).not.toHaveBeenCalled()
    expect(h.calls.filter(c => 'status' in c.body)).toHaveLength(0)
  } finally { await h.dispose() }
})

it('refunds terminal provider errors without recording a successful skill charge', async () => {
  const h = await fixture()
  try {
    h.inject()
    await h.stream(async function* () { yield { type: 'finish', reason: { kind: 'error', error: { code: 'AUTH', message: 'invalid key' } } } })
    expect(h.calls.at(-1)?.body).toEqual({ status: 'failed' })
  } finally { await h.dispose() }
})

it('does not reserve zero-priced skills or disabled accounting', async () => {
  const free = await fixture(0)
  try { free.inject(); await free.stream(free.success); expect(free.calls.some(c => c.path.endsWith('/tasks'))).toBe(false) }
  finally { await free.dispose() }
  const disabled = await fixture()
  try { disabled.disable(); disabled.inject(); await disabled.stream(disabled.success); expect(disabled.calls).toHaveLength(0) }
  finally { await disabled.dispose() }
})
