/** Parent-owned update shutdown: reject busy runtimes before closing any resource. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-tools'
import { createInterface } from 'node:readline'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Synchronously veto shutdown for product work outside an agent turn.
     * @mode emit
     * @param check - Listeners set blocked before returning; they must not await.
     */
    'wanwei-update/check'(check: { blocked: boolean }): void
    /** Freeze new product work after the final idle check.
     * @mode emit
     */
    'wanwei-update/stopping'(): void
  }
}

/** Install update admission and the native parent's private stdin protocol.
 * @param ctx - Product Host with live agents and the launcher's bounded exit service.
 * @returns A shutdown request; false means no resources were closed. True follows whole-tree disposal.
 */
export function installDesktopLifecycle(ctx: Context): () => Promise<boolean> {
  let stopping = false
  let toolOperations = 0
  ctx.on('agent/pre-step', async (_payload, next) => stopping ? { kind: 'reject' } : next())
  ctx.on('tools/execute', async (_payload, next) => {
    if (stopping) throw new Error('桌面端正在安全退出以安装更新')
    toolOperations++
    try { return await next() } finally { toolOperations-- }
  })
  const request = async (): Promise<boolean> => {
    if (stopping || toolOperations > 0) return false
    const exit = ctx.get('appExit')
    const agents = ctx.get('agents')
    if (exit === undefined || agents === undefined) return false
    const check = { blocked: false }
    ctx.emit('wanwei-update/check', check)
    if (check.blocked) return false
    const live = agents.list()
    const jobs = ctx.get('jobs')
    const visibleJobs = jobs === undefined ? [] : [...jobs.list(), ...live.flatMap(agent => jobs.list(agent))]
    if (visibleJobs.some(job => job.status === 'running' || job.status === 'stopping')) return false
    if (live.some(agent => agent.status !== 'idle')) return false
    // Claiming maintenance detects idle-looking compaction/maintenance tasks too.
    // All claims and the admission freeze happen in one synchronous JS interval.
    try {
      for (const agent of live) void agent.runMaintenance(async () => {}).catch((error: unknown) => {
        ctx.logger.warn(`更新空闲检查失败：${String(error)}`)
      })
    } catch { return false }
    stopping = true
    ctx.emit('wanwei-update/stopping')
    // Do not invoke the launcher's five-second forced-exit fallback until all
    // disposers (including persistence and subprocesses) actually settle.
    await ctx.root.fiber.dispose()
    exit(0)
    return true
  }
  if (process.env.DSH_DESKTOP_PARENT_CONTROL === '1') ctx.effect(() => {
    const input = createInterface({ input: process.stdin, terminal: false })
    input.on('line', (line) => {
      if (line === 'wanwei-update-shutdown') {
        void request().then((accepted) => {
          process.stdout.write(`wanwei-update: ${accepted ? 'clean' : 'busy'}\n`)
        }, () => { process.stdout.write('wanwei-update: failed\n') })
      }
    })
    return () => { input.close(); process.stdin.pause() }
  }, 'wanwei: native parent update control')
  return request
}
