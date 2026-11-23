/** Account-owned forum reservations, persistent answer reuse and unified settlement. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Stable question identity shared by quoting and execution. */
export interface ForumQuestion {
  item: { id: string; type: 'article' | 'report' }
  question: string
  action: 'qa' | 'report'
}

/** A result persisted before its configured charge is confirmed. */
export interface ForumAnswer { text: string; provider: string; model: string }

/** Server-authoritative price shown before execution. */
export interface ForumQuote { credits: number; version: number; cached: boolean; action: 'qa' | 'report' }

/** Host execution adapter; website callers never receive account or settlement credentials. */
export interface ForumBilling {
  /** Read the fee for this exact question, including successful-answer reuse.
   * @param input - Validated source, question and action.
   * @param signal - Request cancellation.
   * @returns Current fee and price revision.
   */
  quote(input: ForumQuestion, signal: AbortSignal): Promise<ForumQuote>
  /** Reserve, execute and save an answer with the unified billing receipt.
   * @param input - Question identity, accepted price, fresh session and selected model.
   * @param signal - Cancellation before a successful model result.
   * @param execute - Logged, tool-free model work.
   * @returns Persisted original or newly generated answer.
   */
  run(input: ForumQuestion & { version: number; sessionId: SessionId; provider: string; model: string }, signal: AbortSignal,
    execute: () => Promise<ForumAnswer>): Promise<ForumAnswer>
}

declare module '@deepseek-ai/cordis' { interface Context { wanweiForumBilling: ForumBilling } }

function failure(message: string): never {
  const error = new Error(message)
  error.name = 'PortalAnalysisError'
  throw error
}

/** Install billing for the authenticated desktop account.
 * @param ctx - Lifetime owning settlement retries.
 * @param base - Platform origin.
 * @param resolveToken - Host-only account credential lookup.
 */
export function installForumBilling(ctx: Context, base: string,
  resolveToken: () => Promise<string | undefined>): void {
  const request = async (path: string, token: string, body: object, signal?: AbortSignal) => {
    const response = await fetch(base + '/api/portal/planning-lecture/analysis/' + path, {
      method: 'POST', redirect: 'error', signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const result = await response.json() as { success?: boolean; message?: string; code?: string; data?: unknown; lease?: string }
    if (!response.ok || result.success !== true) {
      failure(result.code === 'INSUFFICIENT_CREDITS' ? '积分不足，请充值后重试'
        : result.code === 'PRICE_CHANGED' ? '讲坛积分配置已变更，请重新发送问题'
          : result.message ?? '无法确认讲坛积分或保存结果，请稍后重试')
    }
    return result
  }
  const credential = async () => {
    const token = await resolveToken()
    if (!token) return failure('请先登录桌面端')
    return token
  }
  const settlements = new Map<string, { token: string; body: object }>()
  let flushing: Promise<void> | undefined
  const flush = () => {
    flushing ??= (async () => {
      for (const [id, entry] of settlements) {
        try { await request(encodeURIComponent(id) + '/result', entry.token, entry.body); settlements.delete(id) }
        catch { /* Retry the same durable attempt; backend expiry refunds an abandoned reservation. */ }
      }
    })().finally(() => { flushing = undefined })
    return flushing
  }
  ctx.provide('wanweiForumBilling', {
    async quote(input, signal) {
      const result = await request('quote', await credential(), input, signal)
      const data = result.data as Partial<ForumQuote> | undefined
      if (!data || typeof data.credits !== 'number' || !Number.isFinite(data.credits) || data.credits < 0
        || !Number.isSafeInteger(data.version) || typeof data.cached !== 'boolean'
        || (data.action !== 'qa' && data.action !== 'report')) return failure('讲坛积分配置无效')
      return data as ForumQuote
    },
    async run(input, signal, execute) {
      const token = await credential()
      const reserved = await request('begin', token, { ...input, session_id: input.sessionId,
        managed_model: input.model }, signal)
      const row = reserved.data as { id?: string; state?: string; text?: string; provider?: string; model?: string } | undefined
      if (!row || typeof row.id !== 'string') return failure('讲坛计费响应无效')
      if (row.state === 'succeeded' && typeof row.text === 'string' && typeof row.provider === 'string' && typeof row.model === 'string') {
        signal.throwIfAborted()
        if (await resolveToken() !== token) return failure('登录账号已变化，请重新打开讲坛')
        return { text: row.text, provider: row.provider, model: row.model }
      }
      if (row.state !== 'running' || typeof reserved.lease !== 'string' || reserved.lease.length !== 72) return failure('讲坛计费凭据无效')
      let answer: ForumAnswer
      try {
        signal.throwIfAborted()
        if (await resolveToken() !== token) return failure('登录账号已变化，请重新打开讲坛')
        answer = await execute()
        signal.throwIfAborted()
      } catch (error) {
        settlements.set(row.id, { token, body: { lease: reserved.lease, status: signal.aborted ? 'cancelled' : 'failed' } })
        await flush()
        throw error
      }
      settlements.set(row.id, { token, body: { lease: reserved.lease, status: 'succeeded', ...answer } })
      await flush()
      if (settlements.has(row.id)) return failure('回答已生成，保存和扣费确认暂未完成，请稍后重试同一问题')
      if (await resolveToken() !== token) return failure('登录账号已变化，请重新打开讲坛')
      return answer
    },
  })
  ctx.effect(() => {
    const timer = setInterval(() => { void flush() }, 10000)
    return async () => { clearInterval(timer); await flush() }
  }, 'wanwei-oneapi-auth: forum settlement retries')
}
