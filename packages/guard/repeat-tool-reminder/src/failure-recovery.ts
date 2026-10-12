/** Cross-step failure coaching; only confirmed invalid inputs can suppress execution. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

interface Options {
  invalidRetryLimit: number
  failureMemorySize: number
  canonicalize(value: unknown): string
  tracked(name: string): boolean
}

interface Failure {
  count: number
  errorKey: string
  operationKey: string
  invalid: boolean
}

const BLOCKED = '相同参数已多次被工具确认无效，本次未执行。请依据此前错误修正参数，或核对是否确实需要这一步。不要换工具重复同一无效操作。其他步骤仍可继续，不要仅因这一步被拦截就结束整个任务。'
const COACH = '工具执行失败不等于整个任务失败。先依据本次原始错误核对参数、路径、前置条件或执行结果，再选择一个针对原因的修正；不要把猜测当成事实。允许有依据的有限重试，但不要原样重复已确认无效的操作，也不要只改变无关参数。权限或安全策略拒绝时不得换工具绕过。已经正确的内容不要为了“修正”而改写；先比较实际内容，必要时只读取相关片段。继续能独立完成的工作，只有必需步骤确实无法推进时才说明具体阻塞和已完成部分，不得声称未验证的内容成功。'
const REPEATED = '这次调用与此前失败调用的参数和错误相同，中间的其他调用不代表问题已经解决。下一步应针对错误改变必要条件或有效参数，而不是再次原样尝试。网络或服务临时故障可在有恢复依据时重试；不要为了避免报错而提前放弃整个任务。'
const NO_CHANGE = '本次修改的新旧文本完全相同，文件没有因此发生修改。先逐字比较实际原文和目标文本；若内容本来正确，跳过修改继续任务；若确有差异，只提交包含真实差异的替换。不要凭显示效果猜测空格或字符，也不要重新抄写整个文件。'
const RELATED = '同一工具的相关操作已反复报告相同错误，虽然参数不同，也需要核对是否真正修正了失败原因。先检查共同的前置条件或实际内容，再作针对性修正；不要只换无关参数，也不要仅凭错误次数判断整个任务无法完成。'

/**
 * Install optional recovery listeners without stopping the agent or changing tool arguments.
 * @param ctx - plugin-owned context; disposing it removes every listener.
 * @param options - validated retry and memory bounds plus the owner's call identity rules.
 */
export function installFailureRecovery(ctx: Context, options: Options): void {
  const failures = new WeakMap<Agent, Map<string, Failure>>()
  const suppressed = new WeakSet<object>()
  const keyOf = (exec: ToolExecution) => createHash('sha256')
    .update(JSON.stringify([exec.name, options.canonicalize(exec.arguments)])).digest('hex')

  ctx.on('tools/pre-execute', async (exec, next) => {
    const downstream = await next()
    if (downstream.kind !== 'allow' || !exec.agent || !options.tracked(exec.name)) return downstream
    const failure = failures.get(exec.agent)?.get(keyOf(exec))
    if (!failure?.invalid || failure.count < options.invalidRetryLimit) return downstream
    suppressed.add(exec.token)
    return { kind: 'deny', reason: BLOCKED }
  })

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next()
    if (!exec.agent || !options.tracked(exec.name) || suppressed.has(exec.token)) return downstream
    const key = keyOf(exec)
    let memory = failures.get(exec.agent)
    const value = result.value
    const foreground = !result.isError && typeof value === 'object' && value !== null && !Array.isArray(value)
      && value.kind === 'foreground' ? value : undefined
    const processFailed = foreground?.aborted !== true
      && (foreground?.timedOut === true || (typeof foreground?.exitCode === 'number' && foreground.exitCode !== 0))
    if (!result.isError && !processFailed && downstream.kind !== 'block') {
      memory?.delete(key)
      return downstream
    }
    // Policy and cancellation are not argument mistakes; their owners provide recovery instructions.
    if (downstream.kind === 'block' || (!result.isError && !processFailed)
      || result.error?.info?.code === 'ABORTED'
      || result.error?.info?.code === 'ABORTED_BEFORE_DISPATCH') return downstream
    const args = exec.arguments
    const noChange = typeof args === 'object' && args !== null
      && 'old_string' in args && 'new_string' in args
      && typeof args.old_string === 'string' && args.old_string === args.new_string
      && result.error?.message === 'old_string and new_string must differ'
    const invalid = result.error?.info?.code === 'INVALID_ARGS' || noChange
    const errorKey = createHash('sha256').update(JSON.stringify([
      result.error?.info?.code, result.error?.message ?? result.content,
    ])).digest('hex')
    const path = typeof args === 'object' && args !== null && 'file_path' in args
      && typeof args.file_path === 'string' ? args.file_path : undefined
    const operationKey = createHash('sha256').update(JSON.stringify([exec.name, path, errorKey])).digest('hex')
    memory ??= new Map()
    failures.set(exec.agent, memory)
    const previous = memory.get(key)
    const count = previous?.errorKey === errorKey ? previous.count + 1 : 1
    memory.delete(key)
    const related = [...memory.values()].some(failure => failure.operationKey === operationKey)
    memory.set(key, { count, errorKey, operationKey, invalid })
    const oldest = memory.keys().next()
    if (memory.size > options.failureMemorySize && !oldest.done) memory.delete(oldest.value)
    const repeat = count > 1 ? REPEATED : related ? RELATED : undefined
    const text = `${COACH}${noChange ? `\n${NO_CHANGE}` : ''}${repeat ? `\n${repeat}` : ''}`
    const notice = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'repeat-tool-reminder', form: 'notice',
        summary: `${exec.name}：纠错引导（${count}）` },
    })
    return { ...downstream, additionalContexts: [notice, ...downstream.additionalContexts ?? []] }
  })

  ctx.on('agent/pre-step', ({ agent, messages }, next) => {
    if (messages.some(message => message.source.kind === 'user')) failures.delete(agent)
    return next()
  })
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle') failures.delete(agent)
  })
}
