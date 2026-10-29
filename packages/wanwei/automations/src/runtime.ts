/** Account-scoped local execution through the ordinary Session Controller. */
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './index.ts'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-wanwei-oneapi-auth'
import type {} from '@deepseek-ai/dsh-wanwei-connectors'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { z } from 'zod'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { AutomationStore, taskInput } from './store.ts'
import { advanceSchedule, nextOccurrence } from './schedule.ts'
import type { AutomationTask, AutomationRun } from './contract.ts'
import { installRunProtocol, RUN_INSTRUCTIONS, workspaceEvidence, verifyOutputFiles } from './run-protocol.ts'

/** Install persistent CRUD and local due-slot claiming.
 * @param ctx - Host context owning timers and execution intervals.
 * @param config - Validated deployment settings.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const store = new AutomationStore(config.dataFile ?? join(resolveDshHome(), 'automations.json'))
  const outputCheck = { documentTool: config.documentTool ?? process.env.DSH_DOCUMENT_TOOL, timeoutMs: config.outputCheckTimeoutMs }
  const lifetime = new AbortController()
  let stoppingForUpdate = false
  let claiming = 0
  let initializing = true
  let ticking: Promise<void> | undefined
  const active = new Map<string, { promise: Promise<void>; owner: string; agent?: Agent }>()
  ctx.on('wanwei-update/check', (check) => {
    if (initializing || active.size > 0 || claiming > 0 || ticking !== undefined) check.blocked = true
  })
  ctx.on('wanwei-update/stopping', () => { stoppingForUpdate = true })
  const account = async (): Promise<string | undefined> => {
    const token = await ctx.credentials.resolve(credentialRef(config.credentialRef))
    const username = await ctx.credentials.resolve(credentialRef('DSH_LOGIN_USERNAME'))
    return token?.value && username?.value ? username.value : undefined
  }
  const owner = async (): Promise<string> => {
    const value = await account()
    if (value === undefined) throw new Error('请先登录后管理定时任务')
    return value
  }
  await store.update((state) => {
    for (const task of state.tasks) if (task.nextRunAt <= Date.now()) advanceSchedule(task, Date.now())
    for (const run of state.runs) {
      for (const delivery of run.deliveries ?? []) if (delivery.status === 'pending') { delivery.status = 'failed'; delivery.error = '推送过程被中断，请检查接收情况后重试' }
      if (run.status !== 'running') continue
      if (run.pid === process.pid) {
        run.status = 'interrupted'; run.endedAt = Date.now(); run.error = '自动化插件重新加载，任务未自动重跑'
        continue
      }
      try { process.kill(run.pid, 0) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
        run.status = 'interrupted'; run.endedAt = Date.now(); run.error = '桌面进程中断，任务未自动重跑'
      }
    }
  })
  const finish = async (id: string, status: AutomationRun['status'], error?: string) => {
    await store.update((state) => {
      const run = state.runs.find(item => item.id === id)
      if (run !== undefined) {
        run.status = status; run.endedAt = Date.now()
        if (error !== undefined) run.error = error.slice(0, 8000)
      }
    })
  }
  const delivering = new Set<string>()
  const deliver = async (id: string, username: string, retry = false): Promise<void> => {
    if (delivering.has(id)) throw new Error('结果正在推送，请稍后重试')
    delivering.add(id)
    try {
      const run = (await store.read()).runs.find(item => item.id === id && item.owner === username)
      if (!run || !run.deliveryText) return
      for (const item of run.deliveries ?? []) {
        if (item.status === 'sent' || (retry && item.status !== 'failed')) continue
        let failure: string | undefined
        try {
          lifetime.signal.throwIfAborted()
          if (await owner() !== username) throw new Error('账号已变化，推送已停止')
          const connectors = ctx.get('wanweiConnectors')
          if (!connectors) throw new Error('连接器服务未加载')
          await connectors.notify(item.channel, run.deliveryText, `${id}:${item.channel}`, lifetime.signal)
        } catch (error) { failure = error instanceof Error ? error.message : String(error) }
        await store.update((state) => {
          const saved = state.runs.find(record => record.id === id && record.owner === username)
          const delivery = saved?.deliveries?.find(row => row.channel === item.channel)
          if (delivery) { delivery.status = failure ? 'failed' : 'sent'; delivery.error = failure }
        })
      }
    } finally { delivering.delete(id) }
  }
  const execute = async (task: AutomationTask, run: AutomationRun, username: string): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    const deadline = new AbortController()
    const runSignal = AbortSignal.any([lifetime.signal, deadline.signal])
    const runOutputCheck = { ...outputCheck, signal: runSignal }
    const hasTimedOut = (): boolean => timedOut
    let agent: Agent | undefined
    let removeProtocol: (() => void) | undefined
    try {
      timer = setTimeout(() => {
        timedOut = true; deadline.abort(); agent?.cancel({ kind: 'hook', reason: '定时任务执行超时' })
      }, config.runTimeoutMs)
      lifetime.signal.throwIfAborted()
      if (await owner() !== username) throw new Error('登录账号已变化，执行已停止')
      if (!(await stat(task.cwd)).isDirectory()) throw new Error('任务工作目录不可用')
      lifetime.signal.throwIfAborted()
      const workspace = await ctx.workspaceRegistry.create(task.cwd)
      const created = await ctx.sessionController.create({ workspaceId: workspace.id })
      agent = ctx.agents.get(created.sessionId)
      if (agent === undefined) throw new Error('任务会话创建失败')
      removeProtocol = installRunProtocol(agent, store, run.id, task.cwd, runOutputCheck)
      const tracked = active.get(run.id)
      if (tracked !== undefined) tracked.agent = agent
      lifetime.signal.throwIfAborted()
      await store.update((state) => {
        const record = state.runs.find(item => item.id === run.id)
        if (record === undefined) throw new Error('运行记录不存在')
        record.sessionId = created.sessionId
      })
      ctx.permissionPresets.set(agent.session, task.fullAccess === false ? 'workspace-write' : 'danger-full-access')
      if (task.model !== undefined) {
        await ctx.sessionController.selectModel({ sessionId: created.sessionId, ...task.model, saveAsDefault: false })
      }
      await ctx.sessionController.rename({ sessionId: created.sessionId, title: `定时任务：${task.name}` })
      if (await owner() !== username) throw new Error('登录账号已变化，执行已停止')
      lifetime.signal.throwIfAborted()
      if (hasTimedOut()) throw new Error('任务初始化超时')
      const connectors = ctx.get('wanweiConnectors')
      const connectorInstructions = (await connectors?.prepare([], agent, runSignal) ?? '')
        + '任务结果由系统按推送设置自动发送，你只需完成任务，不要自行发送结果通知。'
      await ctx.sessionController.prompt({
        sessionId: created.sessionId, requestId: run.id as SessionRequestId, mode: 'queue',
        content: [{ type: 'text', text: `${RUN_INSTRUCTIONS}\n\n${connectorInstructions}\n\n${await workspaceEvidence(task.cwd)}\n\n用户任务：\n${task.prompt}` }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }, lifetime.signal)
      // This fresh Session owns the whole interval; idle alone does not prove success.
      await agent.whenIdle()
      await ctx.sessions.flush(agent.session)
      const end = agent.session.events.findLast(event => event.type === 'turn/end')
      const checkpoint = (await store.read()).runs.find(item => item.id === run.id)?.checkpoint
      if (lifetime.signal.aborted) await finish(run.id, 'interrupted', '自动化插件关闭，执行已停止')
      else if (hasTimedOut()) await finish(run.id, 'failed', `任务执行超过 ${Math.round(config.runTimeoutMs / 1000)} 秒，已停止；进度和文件已保留，可打开会话继续处理`)
      else if (end?.type === 'turn/end' && end.data.reason.kind === 'completed') {
        if (checkpoint?.stage === 'completed') {
          await verifyOutputFiles(task.cwd, checkpoint.files, runOutputCheck)
          runSignal.throwIfAborted()
          await finish(run.id, 'success')
        } else await finish(run.id, checkpoint?.stage === 'waiting' ? 'waiting' : 'incomplete',
          checkpoint?.summary ?? '模型已停止，但没有提交任务完成及成果核验记录；请打开会话查看并继续处理')
      }
      else await finish(run.id, 'failed', end?.type === 'turn/end' && end.data.reason.kind === 'error'
        ? end.data.reason.error.message : `执行未完成：${end?.type === 'turn/end' ? end.data.reason.kind : '没有结束记录'}`)
    } catch (error) {
      agent?.cancel({ kind: 'hook', reason: '定时任务停止' })
      if (agent !== undefined) await agent.whenIdle()
      await finish(run.id, lifetime.signal.aborted ? 'interrupted' : 'failed', hasTimedOut()
        ? '任务执行超时，已停止；进度和文件已保留，可打开会话继续处理'
        : error instanceof Error ? error.message : String(error))
    } finally {
      removeProtocol?.(); if (timer !== undefined) clearTimeout(timer)
      const channels = task.pushChannels ?? []
      if (channels.length) {
        const record = (await store.read()).runs.find(item => item.id === run.id)
        if (record) {
          const message = agent?.session.events.findLast(event => event.type === 'assistant/message')
          const answer = message?.type === 'assistant/message'
            ? message.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim() : ''
          const status = { running: '执行中', success: '已完成', failed: '执行失败', interrupted: '已中断', waiting: '等待确认', incomplete: '未完成' }[record.status]
          const body = [`定时任务：${task.name}`, `状态：${status}`, record.error, answer || record.checkpoint?.summary,
            record.checkpoint?.files.length ? `产物（保存在电脑）：\n${record.checkpoint.files.join('\n')}` : ''].filter(Boolean).join('\n\n')
          await store.update((state) => {
            const saved = state.runs.find(item => item.id === run.id)
            if (saved) { saved.deliveryText = body; saved.deliveries = channels.map(channel => ({ channel, status: 'pending' as const })) }
          })
          await deliver(run.id, username)
        }
      }
    }
  }
  const launch = (task: AutomationTask, run: AutomationRun, username: string) => {
    const tracked: { promise: Promise<void>; owner: string; agent?: Agent } = { promise: Promise.resolve(), owner: username }
    active.set(run.id, tracked)
    tracked.promise = execute(task, run, username).catch((error: unknown) => {
      ctx.logger.error(`自动化运行记录保存失败：${String(error)}`)
    }).finally(() => { active.delete(run.id) })
  }
  const claim = async (id: string | undefined, username: string, now: number): Promise<void> => {
    if (stoppingForUpdate) throw new Error('桌面端正在安装更新，请重启后重试')
    claiming++
    try {
      lifetime.signal.throwIfAborted()
      const claims = await store.update((state) => {
        const claimed: { task: AutomationTask; run: AutomationRun }[] = []
        for (const task of state.tasks) {
          if (task.owner !== username || (id !== undefined && task.id !== id)) continue
          if (id === undefined && (!task.enabled || task.nextRunAt > now)) continue
          if (id === undefined) {
            const overdue = now - task.nextRunAt > config.lateToleranceMs
            advanceSchedule(task, now)
            if (overdue) continue
          }
          if (state.runs.some(run => run.taskId === task.id && run.status === 'running')) {
            if (id !== undefined) throw new Error('这个任务正在执行，请勿重复启动')
            continue
          }
          if (id !== undefined && task.cadence === 'once') { task.enabled = false; task.nextRunAt = 0 }
          const run = { id: randomUUID(), owner: username, pid: process.pid, taskId: task.id, taskName: task.name,
            startedAt: now, status: 'running' as const, trigger: id === undefined ? 'scheduled' as const : 'manual' as const }
          state.runs.push(run); claimed.push({ task: { ...task }, run })
        }
        if (id !== undefined && claimed.length === 0) throw new Error('任务不存在')
        const completed = state.runs.filter(run => run.status !== 'running')
        const keep = new Set(completed.slice(-config.maxRecords).map(run => run.id))
        state.runs = state.runs.filter(run => run.status === 'running' || keep.has(run.id))
        return claimed
      })
      for (const { task, run } of claims) launch(task, run, username)
    } finally { claiming-- }
  }
  let lastOwner: string | undefined
  const tick = async () => {
    if (stoppingForUpdate) return
    const username = await account()
    for (const tracked of active.values()) if (username !== tracked.owner) tracked.agent?.cancel({ kind: 'hook', reason: '登录账号变化' })
    if (username !== lastOwner) {
      await store.update((state) => {
        for (const task of state.tasks) if (task.nextRunAt <= Date.now()) advanceSchedule(task, Date.now())
      })
      lastOwner = username
    }
    if (username === undefined) return
    const state = await store.read()
    if (!state.tasks.some(task => task.owner === username && task.enabled && task.nextRunAt <= Date.now())) return
    await claim(undefined, username, Date.now())
  }
  const remove = ctx.connection.rpc.handle('/desktop-automations', async (endpoint, payload) => {
    try {
      lifetime.signal.throwIfAborted()
      const username = await owner()
      if (endpoint === 'save') {
        const input = z.object({ id: z.string().optional(), task: taskInput }).strict().parse(payload)
        if (!isAbsolute(input.task.cwd) || !(await stat(input.task.cwd)).isDirectory()) throw new Error('请选择有效的绝对工作目录')
        await store.update((state) => {
          const existing = input.id === undefined ? undefined : state.tasks.find(task => task.id === input.id && task.owner === username)
          if (input.id !== undefined && existing === undefined) throw new Error('任务不存在')
          if (existing === undefined && state.tasks.filter(task => task.owner === username).length >= config.maxTasks) {
            throw new Error('任务数量已达上限')
          }
          const value = { ...input.task, id: existing?.id ?? randomUUID(), owner: username,
            nextRunAt: nextOccurrence(input.task, Date.now()) }
          if (value.enabled && value.nextRunAt === 0) throw new Error('所选时间或有效期内没有下一次执行，请调整日期或时间')
          if (existing === undefined) state.tasks.push(value)
          else state.tasks[state.tasks.indexOf(existing)] = value
        })
      } else if (endpoint === 'enable' || endpoint === 'delete') {
        const input = z.object({ ids: z.array(z.string()).min(1), enabled: z.boolean().optional() }).strict().parse(payload)
        await store.update((state) => {
          const tasks = state.tasks.filter(task => input.ids.includes(task.id) && task.owner === username)
          if (new Set(input.ids).size !== tasks.length) throw new Error('部分任务不存在，请刷新')
          if (endpoint === 'delete') {
            if (state.runs.some(run => input.ids.includes(run.taskId) && run.status === 'running')) throw new Error('请先停止正在执行的任务')
            state.tasks = state.tasks.filter(task => !input.ids.includes(task.id))
          } else {
            const enabled = input.enabled
            if (enabled === undefined) throw new Error('缺少启停状态')
            tasks.forEach((task) => {
              task.enabled = enabled; advanceSchedule(task, Date.now())
              if (enabled && task.nextRunAt === 0) throw new Error('任务有效期已结束，请编辑日期后再启用')
            })
          }
        })
      } else if (endpoint === 'retry-delivery') {
        const input = z.object({ id: z.string().min(1) }).strict().parse(payload)
        const run = (await store.read()).runs.find(item => item.id === input.id && item.owner === username)
        if (!run || run.status === 'running') throw new Error('运行记录不存在或任务尚未结束')
        await deliver(input.id, username, true)
      } else if (endpoint === 'delete-run') {
        const input = z.object({ id: z.string().min(1) }).strict().parse(payload)
        await store.update((state) => {
          const run = state.runs.find(run => run.id === input.id && run.owner === username)
          if (run === undefined) throw new Error('运行记录不存在')
          if (run.status === 'running') throw new Error('执行中的记录暂不可删除')
          if (delivering.has(run.id)) throw new Error('推送中的记录暂不可删除')
          state.runs = state.runs.filter(item => item.id !== run.id)
        })
      } else if (endpoint === 'run') {
        const input = z.object({ id: z.string() }).strict().parse(payload)
        await claim(input.id, username, Date.now())
      } else if (endpoint === 'stop') {
        const input = z.object({ id: z.string() }).strict().parse(payload)
        const run = (await store.read()).runs.find(run => run.id === input.id && run.owner === username)
        if (run === undefined) throw new Error('运行记录不存在')
        const tracked = active.get(input.id)
        if (tracked?.agent === undefined) throw new Error('任务尚未开始或由另一个桌面进程执行')
        tracked.agent.cancel({ kind: 'user' })
      } else if (endpoint !== 'list') throw new Error('未知自动化操作')
      return { ok: true, value: await store.snapshot(username) }
    } catch (error) {
      return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} } }
    }
  })
  ctx.effect(() => {
    const interval = setInterval(() => {
      if (ticking !== undefined) return
      ticking = tick().catch((error: unknown) => { ctx.logger.error(`自动化调度失败：${String(error)}`) }).finally(() => { ticking = undefined })
    }, config.tickMs)
    return async () => {
      clearInterval(interval); lifetime.abort(); await remove(); await ticking
      for (const tracked of active.values()) tracked.agent?.cancel({ kind: 'disposed' })
      await Promise.all([...active.values()].map(tracked => tracked.promise))
    }
  }, 'wanwei-automations: local scheduler')
  initializing = false
}
