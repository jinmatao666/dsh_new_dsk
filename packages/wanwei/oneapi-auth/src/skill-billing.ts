/** Skill use settles through the shared billing service. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { createHash } from 'node:crypto'
import { LlmError, QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'

export interface SkillOperation<T> {
  /** Stable business identity, reused when the same operation is retried. */
  operationId: string
  skillName: string
  sessionId?: string
  turnId?: number
  signal: AbortSignal
  /** Concrete work. A failed business result must return succeeded:false or throw. */
  execute: () => Promise<{ succeeded: boolean; value: T }>
}

/** Explicit skill execution boundary, owned by the trusted desktop Host. */
export interface SkillExecutor {
  run<T>(operation: SkillOperation<T>): Promise<{ succeeded: boolean; value: T }>
}

/** Create the desktop's explicit skill executor.
 * Only concrete execution adapters may call run; loading a skill does not call it.
 * @param ctx - Plugin lifetime for settlement retry and disposal.
 * @param base - Platform origin.
 * @param resolveToken - Current paying user's credential.
 * @returns Account-aware execution wrapper using the shared billing API.
 */
export function createSkillExecutor(ctx: Context, base: string, resolveToken: () => Promise<string | undefined>): SkillExecutor {
  interface Reservation { id: string; token: string }
  const settlements = new Map<string, { reservation: Reservation; status: string }>()
  const active = new Map<string, Promise<{ succeeded: boolean; value: unknown }>>()
  const finished = new Set<string>()
  let disposed = false, flushing = false
  const request = async (path: string, token: string, body?: object, signal?: AbortSignal) => {
    const response = await fetch(base + '/api/billing/v1/' + path, {
      method: body ? 'POST' : 'GET', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const value = await response.json() as { success?: boolean; code?: string; data?: unknown; task_token?: string }
    return { response, value }
  }
  const flush = async () => {
    if (flushing || disposed) return
    flushing = true
    try {
      for (const [id, item] of settlements) {
        try {
          const { response, value } = await request('tasks/' + encodeURIComponent(id) + '/result', item.reservation.token, { status: item.status })
          if (response.ok && value.success || response.status === 409 || response.status === 404) settlements.delete(id)
        } catch { /* Retry only this task's terminal result; backend expiry is crash recovery. */ }
      }
    } finally { flushing = false }
  }
  const settle = async (reservation: Reservation | undefined, status: string) => {
    if (!reservation) return
    settlements.set(reservation.id, { reservation, status })
    await flush()
  }
  const run: SkillExecutor['run'] = async <T>(operation: SkillOperation<T>) => {
    if (disposed) throw new Error('技能执行入口已关闭')
    if (!operation.operationId || operation.operationId.length > 128 || !operation.skillName) throw new Error('技能执行参数无效')
    operation.signal.throwIfAborted()
    const token = await resolveToken()
    if (!token) throw new Error('请先登录')
    const identity = createHash('sha256').update(JSON.stringify([token, operation.operationId, operation.skillName])).digest('hex')
    if (finished.has(identity)) throw new Error('本次技能操作已经结束，请勿重复执行')
    const existing = active.get(identity)
    if (existing) return await existing as { succeeded: boolean; value: T }
    const execution = (async () => {
      let reservation: Reservation | undefined
      if (ctx.get('wanweiNetworkPolicy')?.getSnapshot().billing?.enabled !== false) {
        const quote = await request('quote?' + new URLSearchParams({ kind: 'skill', item_id: operation.skillName, action: 'default' }), token, undefined, operation.signal)
        if (!(quote.response.status === 404 && quote.value.code === 'NOT_FOUND')) {
          if (!quote.response.ok || !quote.value.success) throw new Error('无法确认技能价格，已停止执行')
          const data = quote.value.data as { rule?: { version: number; enabled: boolean; unit_quota: number } }
          if (!data.rule || !Number.isSafeInteger(data.rule.version) || !Number.isSafeInteger(data.rule.unit_quota)) throw new Error('技能计费配置无效')
          if (!data.rule.enabled) throw new Error('技能计费已关闭，已停止执行')
          if (data.rule.unit_quota > 0) {
            const reserved = await request('tasks', token, {
              kind: 'skill', item_id: operation.skillName, action: 'default', quantity: 1,
              version: data.rule.version, request_id: identity,
              ...(operation.sessionId === undefined ? {} : { session_id: operation.sessionId, turn_id: operation.turnId }),
            }, operation.signal)
            if (!reserved.response.ok || !reserved.value.success) {
              if (reserved.value.code === 'INSUFFICIENT_CREDITS') throw new LlmError('积分不足，任务已中断。', QUOTA_EXCEEDED_CODE)
              throw new Error('技能积分预留失败，已停止执行')
            }
            const task = reserved.value.data as { id?: unknown }
            if (typeof task?.id !== 'string' || !reserved.value.task_token) throw new Error('技能计费任务已存在，请核对原任务后重试')
            reservation = { id: task.id, token: reserved.value.task_token }
          }
        }
      }
      try {
        operation.signal.throwIfAborted()
        if (disposed || await resolveToken() !== token) throw new Error('登录账号已变化或执行入口已关闭')
        const result = await operation.execute()
        operation.signal.throwIfAborted()
        await settle(reservation, result.succeeded ? 'succeeded' : 'failed')
        return result
      } catch (error) {
        await settle(reservation, operation.signal.aborted ? 'cancelled' : 'failed')
        throw error
      }
    })()
    active.set(identity, execution)
    try { return await execution } finally { active.delete(identity); finished.add(identity) }
  }
  ctx.effect(() => {
    const timer = setInterval(() => { void flush() }, 10000)
    return () => { disposed = true; clearInterval(timer) }
  }, 'wanwei-oneapi-auth: explicit skill execution settlement')
  return { run }
}

/** Bill each successful model-originated skill tool call, with call identity preventing retry duplication.
 * @param ctx - Host plugin lifetime.
 * @param base - Platform origin.
 * @param resolveToken - Current paying account.
 */
export function installSkillCallBilling(ctx: Context, base: string, resolveToken: () => Promise<string | undefined>): void {
  const executor = createSkillExecutor(ctx, base, resolveToken)
  const turns = new Map<string, number>()
  ctx.on('agent/request', async ({ agent, turn }, next) => {
    turns.set(String(agent.session.id), turn)
    return next()
  })
  ctx.on('agent/turn-stopping', ({ agent }) => { turns.delete(String(agent.session.id)) })
  ctx.inject(['tools'], scope => scope.on('tools/execute', async (exec, next) => {
    if (exec.name !== 'skill' || !exec.agent) return next()
    const name = (exec.arguments as { name?: unknown } | null)?.name
    if (typeof name !== 'string' || !name) return next()
    const operationId = createHash('sha256').update(JSON.stringify([exec.agent.session.id, exec.callId])).digest('hex')
    const sessionId = String(exec.agent.session.id)
    const turnId = turns.get(sessionId)
    const result = await executor.run({
      operationId, skillName: name, signal: exec.signal,
      sessionId,
      ...(turnId === undefined ? {} : { turnId }),
      execute: async () => {
        const value = await next()
        return { succeeded: !value.isError, value }
      },
    })
    return result.value
  }))
}
