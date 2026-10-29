import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
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
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { createSessionTestController } from '../../../api/session-controller/tests/test-remote.ts'
import * as Automations from '../src/index.ts'
import { AutomationStore } from '../src/store.ts'
import type { ConnectionRpcHandler, ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import type { AutomationSnapshot } from '../src/contract.ts'

// Only transport, credentials and the model boundary are scripted; execution uses the real Agent loop.
it.each(['internet', 'intranet'])('loads the plugin, persists and executes real Sessions in %s mode', async (mode) => {
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
    await writeFile(join(dir, 'final.txt'), 'actual delivered result')
    const report = (label: string) => [
      toolCallResponse(`${label}-preflight`, 'automation_checkpoint', { stage: 'preflight', summary: '检查完成，本任务仅需文字回答', nextSteps: ['回答'], files: [], producesFiles: false }),
      toolCallResponse(`${label}-completed`, 'automation_checkpoint', { stage: 'completed', summary: label, nextSteps: [], files: [], producesFiles: false }),
      textResponse(label),
    ]
    const adapter = new MockAdapter([
      ...report('真实执行链路结果'), ...report('定时执行结果'),
      toolCallResponse('long-preflight', 'automation_checkpoint', { stage: 'preflight', summary: '必要条件已核对', nextSteps: ['阶段一'], files: [], producesFiles: false }),
      toolCallResponse('long-progress', 'automation_checkpoint', { stage: 'progress', summary: '阶段一已完成', nextSteps: ['阶段二'], files: [], producesFiles: false }),
      'hang', ...report('单次完成'), ...report('手动单次完成'),
      toolCallResponse('missing-input', 'automation_checkpoint', { stage: 'waiting', summary: '缺少任务所需的资料', nextSteps: ['请用户补充资料'], files: [], producesFiles: true }),
      textResponse('缺少输入，未生成文件'), textResponse('没有提交核验记录'),
      toolCallResponse('premature-complete', 'automation_checkpoint', { stage: 'completed', summary: '错误完成声明', nextSteps: [], files: [], producesFiles: true }),
      toolCallResponse('file-preflight', 'automation_checkpoint', { stage: 'preflight', summary: '需要最终文件', nextSteps: ['核验文件'], files: [], producesFiles: true }),
      toolCallResponse('missing-file', 'automation_checkpoint', { stage: 'completed', summary: '不能确认不存在的文件', nextSteps: [], files: ['missing.txt'], producesFiles: true }),
      toolCallResponse('valid-file', 'automation_checkpoint', { stage: 'completed', summary: '已读取 final.txt 验证内容', nextSteps: [], files: ['final.txt'], producesFiles: true }),
      textResponse('交付已核验的文件'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    new SessionTitleService(ctx, { fallbackMaxWords: 10, fallbackMaxBytes: 120, maxTitleBytes: 200 })
    const attached: string[] = []
    const workspace = { id: 'test-workspace', path: dir, attachSession: async (id: string) => { attached.push(id) } }
    const archiveSession = vi.fn()
    ctx.provide('workspaceRegistry', { create: async () => workspace, get: () => workspace, list: () => [],
      archiveSession,
    } as never)
    ctx.provide('credentials', { resolve: async (ref: string) => authenticated ? {
      value: ref === 'DSH_LOGIN_USERNAME' ? 'account-a' : 'test-token',
    } : undefined } as never)
    ctx.provide('connection', { rpc: { handle: (_channel: string, next: ConnectionRpcHandler) => {
      handler = next; return async () => { handler = undefined }
    } } } as never)
    const notify = vi.fn(async (channel: string, _text: string) => {
      if (channel === 'dingtalk' && notify.mock.calls.filter(call => call[0] === 'dingtalk').length === 1) throw new Error('授权已失效')
    })
    const prepare = vi.fn(async () => '推送由系统负责，不调用连接器发送结果。')
    ctx.provide('wanweiConnectors', { options: async () => [], prepare, notify })
    ctx.provide('wanweiNetworkPolicy', { getSnapshot: () => ({ mode }) } as never)
    ctx.provide('shell', { sandboxMode: 'workspace-write' } as never)
    ctx.provide('approval', { config: { policy: 'ask' } } as never)
    await ctx.plugin(PermissionPresets).await()
    const setPermission = vi.spyOn(ctx.permissionPresets, 'set')
    const saveDefault = vi.fn()
    createSessionTestController(ctx, { cwd: dir, defaultModelSelection: () => ({ provider: 'mock', model: 'mock' }), saveDefaultModelSelection: saveDefault })
    const historical = ctx.sessions.create(SessionId('historical-automation'))
    await new AutomationStore(join(dir, 'tasks.json')).update((state) => {
      state.runs.push({ id: 'historical-run', taskId: 'removed-task', taskName: '旧任务', owner: 'account-a',
        pid: process.pid, status: 'failed', startedAt: 1, endedAt: 2, trigger: 'manual', sessionId: historical.id })
    })
    const config = join(dir, 'cordis.yml')
    await writeFile(config, '- name: automations\n  config:\n    runTimeoutMs: 10000\n    dataFile: ' + JSON.stringify(join(dir, 'tasks.json')) + '\n')
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
    expect(archiveSession).not.toHaveBeenCalled()
    const call = async (op: string, payload: unknown): Promise<AutomationSnapshot> => {
      const result = await handler!(op, payload, new AbortController().signal) as ConnectionRpcResult<AutomationSnapshot>
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
    const saved = await call('save', { task: { name: '测试任务', prompt: '只回复完成', cwd: dir,
      cadence: 'daily', time: '09:00', enabled: false, pushChannels: ['feishu', 'dingtalk', 'wechat'], model: { provider: 'mock', model: 'task-model' } } })
    expect(saved.tasks).toHaveLength(1)
    expect((await new AutomationStore(join(dir, 'tasks.json')).snapshot('account-a')).tasks).toHaveLength(1)
    await call('run', { id: saved.tasks[0]!.id })
    await expect.poll(async () => (await call('list', {})).runs[0]).toMatchObject({ status: 'success' })
    const run = (await call('list', {})).runs[0]!
    expect(run.sessionId).toBeTruthy()
    expect(attached).toContain(run.sessionId)
    expect(ctx.sessions.get(SessionId(run.sessionId!))?.header.cwd).toBe(dir)
    expect(archiveSession).not.toHaveBeenCalled()
    expect(adapter.requests).toHaveLength(3)
    await expect.poll(async () => (await call('list', {})).runs[0]?.deliveries?.map(row => row.status)).toEqual(['sent', 'failed', 'sent'])
    expect(notify.mock.calls[0]?.[1]).toContain('真实执行链路结果')
    expect(prepare.mock.calls[0]?.[0]).toEqual([])
    await call('retry-delivery', { id: run.id })
    expect((await call('list', {})).runs[0]?.deliveries?.map(row => row.status)).toEqual(['sent', 'sent', 'sent'])
    expect(notify.mock.calls.filter(row => row[0] === 'feishu')).toHaveLength(1)
    expect(adapter.requests).toHaveLength(3)

    expect(adapter.requests[0]).toMatchObject({ model: 'task-model' })
    expect(saveDefault).not.toHaveBeenCalled()
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
    expect(adapter.requests).toHaveLength(6)
    expect(setPermission).toHaveBeenCalledTimes(2)
    expect(setPermission.mock.calls.every(([, preset]) => preset === 'danger-full-access')).toBe(true)
    expect((await call('list', {})).runs[0]?.trigger).toBe('scheduled')
    expect((await call('list', {})).runs.filter(item => item.id !== 'historical-run')
      .every(item => item.sessionId !== undefined && attached.includes(item.sessionId))).toBe(true)
    await call('save', { id: saved.tasks[0]!.id, task: { name: '测试任务', prompt: '只回复完成', cwd: dir,
      cadence: 'daily', time: '09:00', enabled: false, fullAccess: false } })
    expect((await call('list', {})).tasks[0]?.model).toBeUndefined()
    await call('run', { id: saved.tasks[0]!.id })
    await expect(call('run', { id: saved.tasks[0]!.id })).rejects.toThrow('正在执行')
    const running = (await call('list', {})).runs[0]!
    const updateCheck = { blocked: false }
    ctx.emit('wanwei-update/check', updateCheck)
    expect(updateCheck.blocked).toBe(true)
    await expect.poll(() => setPermission.mock.calls.at(-1)?.[1]).toBe('workspace-write')
    await expect(call('delete-run', { id: running.id })).rejects.toThrow('执行中的记录暂不可删除')
    await expect.poll(async () => (await call('list', {})).runs[0]?.status, { timeout: 15000 }).toBe('failed')
    expect((await call('list', {})).runs[0]?.error).toBe('任务执行超过 10 秒，已停止；进度和文件已保留，可打开会话继续处理')
    const timedRun = (await call('list', {})).runs[0]!
    expect(timedRun.checkpoint, JSON.stringify(ctx.sessions.get(SessionId(timedRun.sessionId!))?.events
      .filter(event => event.type === 'tool/result'))).toMatchObject({ summary: '阶段一已完成', nextSteps: ['阶段二'] })
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    await call('save', { id: saved.tasks[0]!.id, task: { name: '单次任务', prompt: '只回复完成', cwd: dir,
      cadence: 'once', startDate: today, time, enabled: false } })
    await store.update((state) => { state.tasks[0]!.enabled = true; state.tasks[0]!.nextRunAt = Date.now() - 1 })
    await expect.poll(async () => (await call('list', {})).runs[0]).toMatchObject({ status: 'success' })
    await expect.poll(() => adapter.requests.length).toBe(12)
    expect((await call('list', {})).tasks[0]).toMatchObject({ enabled: false, nextRunAt: 0 })
    await expect(call('enable', { ids: [saved.tasks[0]!.id], enabled: true })).rejects.toThrow('有效期已结束')
    await call('save', { id: saved.tasks[0]!.id, task: { name: '手动单次任务', prompt: '只回复完成', cwd: dir,
      cadence: 'once', startDate: `${now.getFullYear() + 1}-12-20`, time: '09:00', enabled: true } })
    const previousRuns = (await call('list', {})).runs.length
    await call('run', { id: saved.tasks[0]!.id })
    await expect.poll(() => adapter.requests.length).toBe(15)
    await expect.poll(async () => (await call('list', {})).runs[0]?.status).toBe('success')
    expect((await call('list', {})).runs).toHaveLength(previousRuns + 1)
    expect((await call('list', {})).tasks[0]).toMatchObject({ enabled: false, nextRunAt: 0 })
    await store.update((state) => { state.runs.push({ ...state.runs[0]!, id: 'other-account-run', owner: 'account-b' }) })
    await expect(call('delete-run', { id: 'other-account-run' })).rejects.toThrow('运行记录不存在')
    const removed = await call('delete-run', { id: run.id })
    expect(removed.runs.some(item => item.id === run.id)).toBe(false)
    expect(removed.tasks).toHaveLength(1)
    expect(ctx.sessions.get(SessionId(run.sessionId!))).toBeDefined()
    expect((await new AutomationStore(join(dir, 'tasks.json')).read()).runs.some(item => item.id === 'other-account-run')).toBe(true)
    await call('run', { id: saved.tasks[0]!.id })
    await expect.poll(async () => (await call('list', {})).runs[0]?.status).toBe('waiting')
    expect((await call('list', {})).runs[0]?.checkpoint).toMatchObject({ stage: 'waiting', nextSteps: ['请用户补充资料'] })
    await call('run', { id: saved.tasks[0]!.id })
    await expect.poll(async () => (await call('list', {})).runs[0]?.status).toBe('incomplete')
    expect((await call('list', {})).runs[0]?.error).toContain('没有提交任务完成')
    await call('run', { id: saved.tasks[0]!.id })
    const finalPath = await realpath(join(dir, 'final.txt'))
    await expect.poll(async () => (await call('list', {})).runs[0]).toMatchObject({ status: 'success',
      checkpoint: { stage: 'completed', files: [finalPath] } })
    const verifiedRun = (await call('list', {})).runs[0]!
    const verificationEvents = ctx.sessions.get(SessionId(verifiedRun.sessionId!))!.events
    expect(verificationEvents.filter(event => event.type === 'tool/result' && event.data.message.content[0].isError)).toHaveLength(2)
    expect(archiveSession).not.toHaveBeenCalled()
    expect(ctx.tools.get('automation_checkpoint')).toBeUndefined()
    ctx.emit('wanwei-update/stopping')
    await expect(call('run', { id: saved.tasks[0]!.id })).rejects.toThrow('正在安装更新')
    authenticated = false
    await expect(call('list', {})).rejects.toThrow('请先登录')
    await ctx.fiber.dispose()
    expect(handler).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  }
}, 30000)

it('allows an hour by default while retaining an explicit deployment timeout', () => {
  // Loader input omits defaults; the schema's callable type describes its resolved output.
  expect(Automations.Config({} as Automations.Config).runTimeoutMs).toBe(3600000)
  expect(Automations.Config({ runTimeoutMs: 120000 } as Automations.Config).runTimeoutMs).toBe(120000)
})
