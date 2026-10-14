import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SessionTitleService } from '@deepseek-ai/dsh-session-title'
import PermissionPresets from '@deepseek-ai/dsh-permission-presets'
import { expect, it, vi } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { createSessionTestController } from '../../../api/session-controller/tests/test-remote.ts'
import * as Automations from '../src/index.ts'
import { AutomationStore } from '../src/store.ts'
import type { ConnectionRpcHandler, ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import type { AutomationSnapshot } from '../src/contract.ts'

// Only transport, credentials and the model boundary are scripted; execution uses the real Agent loop.
it('loads the plugin, persists a task, executes a real Session and records its completion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-automation-runtime-'))
  const ctx = new Context()
  let handler: ConnectionRpcHandler | undefined
  let authenticated = true
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    const adapter = new MockAdapter([textResponse('真实执行链路结果'), textResponse('定时执行结果'), 'hang'])
    ctx.llm.registerAdapter(['mock'], adapter)
    new SessionTitleService(ctx, { fallbackMaxWords: 10, fallbackMaxBytes: 120, maxTitleBytes: 200 })
    const workspace = { id: 'test-workspace', path: dir, attachSession: async () => {} }
    const archived = new Set<string>()
    ctx.provide('workspaceRegistry', { create: async () => workspace, get: () => workspace, list: () => [],
      archiveSession: async (id: string) => { archived.add(id) },
    } as never)
    ctx.provide('credentials', { resolve: async (ref: string) => authenticated ? {
      value: ref === 'DSH_LOGIN_USERNAME' ? 'account-a' : 'test-token',
    } : undefined } as never)
    ctx.provide('connection', { rpc: { handle: (_channel: string, next: ConnectionRpcHandler) => {
      handler = next; return async () => { handler = undefined }
    } } } as never)
    ctx.provide('wanweiNetworkPolicy', { getSnapshot: () => ({ mode: 'internet' }) } as never)
    ctx.provide('shell', { sandboxMode: 'workspace-write' } as never)
    ctx.provide('approval', { config: { policy: 'ask' } } as never)
    await ctx.plugin(PermissionPresets).await()
    const setPermission = vi.spyOn(ctx.permissionPresets, 'set')
    createSessionTestController(ctx, { cwd: dir, defaultModelSelection: () => ({ provider: 'mock', model: 'mock' }) })
    const historical = ctx.sessions.create(SessionId('historical-automation'))
    await new AutomationStore(join(dir, 'tasks.json')).update((state) => {
      state.runs.push({ id: 'historical-run', taskId: 'removed-task', taskName: '旧任务', owner: 'account-a',
        pid: process.pid, status: 'failed', startedAt: 1, endedAt: 2, trigger: 'manual', sessionId: historical.id })
    })
    const config = join(dir, 'cordis.yml')
    await writeFile(config, '- name: automations\n  config:\n    runTimeoutMs: 1000\n    dataFile: ' + JSON.stringify(join(dir, 'tasks.json')) + '\n')
    ctx.baseUrl = pathToFileURL(dir).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = { version: 'v2', async import(name: string) {
      if (name !== 'automations') throw new Error(name)
      return Automations
    } } as never
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
    await ctx.loader.await()
    expect(handler).toBeTypeOf('function')
    expect(archived.has(historical.id)).toBe(true)
    const call = async (op: string, payload: unknown): Promise<AutomationSnapshot> => {
      const result = await handler!(op, payload, new AbortController().signal) as ConnectionRpcResult<AutomationSnapshot>
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
    const saved = await call('save', { task: { name: '测试任务', prompt: '只回复完成', cwd: dir,
      cadence: 'daily', time: '09:00', enabled: false } })
    expect(saved.tasks).toHaveLength(1)
    expect((await new AutomationStore(join(dir, 'tasks.json')).snapshot('account-a')).tasks).toHaveLength(1)
    await call('run', { id: saved.tasks[0]!.id })
    await expect.poll(async () => (await call('list', {})).runs[0]?.status).toBe('success')
    const run = (await call('list', {})).runs[0]!
    expect(run.sessionId).toBeTruthy()
    expect(archived.has(run.sessionId!)).toBe(true)
    expect(adapter.requests).toHaveLength(1)
    expect(setPermission).toHaveBeenCalledWith(ctx.sessions.get(SessionId(run.sessionId!)), 'danger-full-access')
    const events = ctx.sessions.get(SessionId(run.sessionId!))!.events
    expect(events.filter(event => event.type === 'sandbox/mode').at(-1)?.data).toEqual({ mode: 'danger-full-access' })
    expect(events.filter(event => event.type === 'approval/policy').at(-1)?.data).toEqual({ policy: 'never' })
    expect(ctx.permissionPresets.current(historical.events)).toBe('workspace-write')
    expect(ctx.sessions.get(SessionId(run.sessionId!))?.events.some(event => event.type === 'turn/end')).toBe(true)
    // Establish the first account tick before installing a due slot.
    await new Promise(resolve => setTimeout(resolve, 1200))
    const store = new AutomationStore(join(dir, 'tasks.json'))
    await store.update((state) => { state.tasks[0]!.enabled = true; state.tasks[0]!.nextRunAt = Date.now() - 1 })
    await expect.poll(async () => (await call('list', {})).runs.filter(item => item.status === 'success').length).toBe(2)
    expect(adapter.requests).toHaveLength(2)
    expect(setPermission).toHaveBeenCalledTimes(2)
    expect(setPermission.mock.calls.every(([, preset]) => preset === 'danger-full-access')).toBe(true)
    expect((await call('list', {})).runs[0]?.trigger).toBe('scheduled')
    expect((await call('list', {})).runs.every(item => item.sessionId !== undefined && archived.has(item.sessionId))).toBe(true)
    await call('run', { id: saved.tasks[0]!.id })
    await expect(call('run', { id: saved.tasks[0]!.id })).rejects.toThrow('正在执行')
    const running = (await call('list', {})).runs[0]!
    await expect(call('delete-run', { id: running.id })).rejects.toThrow('执行中的记录暂不可删除')
    await expect.poll(async () => (await call('list', {})).runs[0]?.status).toBe('failed')
    expect((await call('list', {})).runs[0]?.error).toContain('超时')
    await store.update((state) => { state.runs.push({ ...state.runs[0]!, id: 'other-account-run', owner: 'account-b' }) })
    await expect(call('delete-run', { id: 'other-account-run' })).rejects.toThrow('运行记录不存在')
    const removed = await call('delete-run', { id: run.id })
    expect(removed.runs.some(item => item.id === run.id)).toBe(false)
    expect(removed.tasks).toHaveLength(1)
    expect(ctx.sessions.get(SessionId(run.sessionId!))).toBeDefined()
    expect((await new AutomationStore(join(dir, 'tasks.json')).read()).runs.some(item => item.id === 'other-account-run')).toBe(true)
    authenticated = false
    await expect(call('list', {})).rejects.toThrow('请先登录')
    await ctx.fiber.dispose()
    expect(handler).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  }
}, 15000)
