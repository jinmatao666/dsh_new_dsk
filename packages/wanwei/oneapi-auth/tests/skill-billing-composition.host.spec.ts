import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, vi } from 'vitest'
import { createSkillExecutor, type SkillExecutor } from '../src/skill-billing.ts'

it('keeps loader-composed instruction loads free and bills only explicit execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-billing-'))
  const ctx = new Context()
  let settled = false, reserves = 0
  let executor: SkillExecutor
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/quote?')) return Response.json({ success: true, data: { rule: { version: 1, unit_quota: 20, enabled: true } } })
    if (url.endsWith('/tasks')) { reserves++; return Response.json({ success: true, data: { id: 'task' }, task_token: 'capability' }) }
    settled = true
    return Response.json({ success: true })
  }))
  try {
    const file = join(root, 'cordis.yml')
    await writeFile(file, '- name: skill-billing-test\n')
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = { version: 'v2', async import() {
      return { name: 'skill-billing-test', apply(scope: Context) { executor = createSkillExecutor(scope, 'https://platform.test', async () => 'account') } }
    } } as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(file).href } })
    await ctx.loader.await()
    const session = { id: 'composed-session', events: [] }
    const payload = { agent: { session }, turn: 1, step: 1, signal: new AbortController().signal, messages: [] }
    const decision = { kind: 'enter', messages: [{ source: { kind: 'skill-invocation', name: 'pdf' } }] }
    await ctx.waterfall('agent/pre-step', payload as never, () => Promise.resolve(decision as never))
    expect(reserves).toBe(0)
    expect(settled).toBe(false)
    ctx.emit('session/event', session as never, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } as never)

    expect(settled).toBe(false)
    const execute = vi.fn(async () => ({ succeeded: true, value: 'done' }))
    const operation = { skillName: 'pdf', operationId: 'pdf-task-1', signal: new AbortController().signal, execute }
    await executor!.run(operation)
    expect(execute).toHaveBeenCalledOnce()
    expect(reserves).toBe(1)
    expect(settled).toBe(true)
    await ctx.fiber.dispose()
    await expect(executor!.run({ ...operation, operationId: 'pdf-task-2' })).rejects.toThrow('已关闭')
    expect(reserves).toBe(1)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
    vi.unstubAllGlobals()
  }
})
