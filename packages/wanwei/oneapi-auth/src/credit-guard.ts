/** Stop managed-model tool dispatch when the account has exhausted its credits. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { LlmError, QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'

/** Install account checks before managed-model tool side effects.
 * @param ctx - Product lifetime.
 * @param baseURL - Platform origin.
 * @param provider - Managed provider identifier.
 * @param resolveToken - Current Host-owned credential.
 */
export function installCreditGuard(ctx: Context, baseURL: string, provider: string, resolveToken: () => Promise<string | undefined>): void {
  const managed = (agent: Agent): boolean => {
    const last = agent.session.events.findLast(event => event.type === 'assistant/message')
    if (last?.type === 'assistant/message') return last.data.message.source.provider === provider
    return agent.options.provider === provider
  }
  const check = async (agent: Agent, signal: AbortSignal): Promise<void> => {
    if (!managed(agent)) return
    const token = await resolveToken()
    if (!token) throw new Error('登录状态已失效，请重新登录')
    const response = await fetch(baseURL + '/api/user/self/credit-availability', {
      signal, redirect: 'error', headers: { authorization: `Bearer ${token}` },
    })
    const body = await response.json() as { success?: boolean; data?: { enabled: boolean; available: boolean } }
    if (!response.ok || body.success !== true || !body.data) throw new Error('无法确认积分余额，已停止执行')
    if (await resolveToken() !== token) throw new Error('登录账号已变化，已停止执行')
    if (body.data.enabled && !body.data.available) throw new LlmError('积分不足，任务已中断。', QUOTA_EXCEEDED_CODE)
  }
  ctx.inject(['tools'], scope => scope.on('tools/pre-execute', async (exec, next) => {
    if (exec.agent) await check(exec.agent, exec.signal)
    return next()
  }))
}
