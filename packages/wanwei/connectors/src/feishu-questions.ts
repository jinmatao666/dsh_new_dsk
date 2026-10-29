/** Shared desktop/Feishu ownership of clarification answers in one bound session. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'

interface Binding { sessionId: SessionId; messageId: string; signal: AbortSignal }
interface Pending {
  binding: Binding
  questions: AskUserQuestionItem[]
  answers: AskUserQuestionAnswer['answers']
  resolve: (answer: AskUserQuestionAnswer) => void
  reject: (error: Error) => void
  key: string
}

/** Mount a competing answerer while keeping the existing desktop form active.
 * @param ctx - Connector-owned context; unrelated questions delegate untouched.
 * @param options - Current authenticated binding and bounded message delivery.
 * @returns Owner-checked inbound answer routing and lifecycle cleanup.
 */
export function installFeishuQuestions(ctx: Context, options: {
  binding: () => Binding | undefined
  verify: (signal: AbortSignal) => Promise<void>
  send: (messageId: string, text: string, key: string, signal: AbortSignal) => Promise<void>
}) {
  let pending: Pending | undefined
  const present = (entry: Pending) => {
    const index = entry.answers.length
    const question = entry.questions[index]
    if (!question) return
    const text = [`请回答第 ${index + 1}/${entry.questions.length} 个问题：${question.question}`,
      question.detail ?? '', ...(question.options ?? []).map((option, i) => `${i + 1}. ${option.label}${option.description ? `：${option.description}` : ''}`),
      question.multiSelect ? '回复选项编号或名称，多选请用逗号分隔；也可以直接输入补充内容。' : '回复选项编号或名称，也可以直接输入补充内容。',
      '也可在桌面回答；先完成的一端生效。'].filter(Boolean).join('\n')
    return options.send(entry.binding.messageId, text, `${entry.key}:${index}`, entry.binding.signal)
  }
  const unsubscribe = ctx.on('user-questions/request', async (request, next) => {
    const binding = options.binding()
    if (!binding || request.agent?.session.id !== binding.sessionId
      || request.questions.some(question => question.intent !== undefined)) return next()
    if (pending) return next()
    const original = request.signal
    const desktop = new AbortController()
    const signal = AbortSignal.any([binding.signal, ...(original ? [original] : [])])
    // UserQuestionService supplies an invocation-local copy. Only the forwarded
    // desktop form gets this cancellation lifetime; the agent tool keeps its own.
    request.signal = AbortSignal.any([signal, desktop.signal])
    let resolve!: Pending['resolve']; let reject!: Pending['reject']
    const mobile = new Promise<AskUserQuestionAnswer>((accept, fail) => { resolve = accept; reject = fail })
    const entry: Pending = { binding, questions: request.questions, answers: [], resolve, reject, key: randomUUID() }
    pending = entry
    const stopped = () => { reject(new Error('飞书问答已取消')) }
    signal.addEventListener('abort', stopped, { once: true })
    if (signal.aborted) stopped()
    const local = next()
    void present(entry)?.catch(() => { /* The desktop form remains available if delivery fails. */ })
    try { return await Promise.race([mobile, local]) }
    finally {
      if (pending === entry) pending = undefined
      signal.removeEventListener('abort', stopped)
      desktop.abort()
    }
  }, { prepend: true })
  return {
    hasPending(): boolean { return pending !== undefined },
    async answer(text: string): Promise<boolean> {
      const entry = pending
      if (!entry) return false
      await options.verify(entry.binding.signal)
      entry.binding.signal.throwIfAborted()
      if (pending !== entry) return true
      const question = entry.questions[entry.answers.length]
      if (!question) return true
      const tokens = [...new Set(text.trim().split(/[,，、]/).map(part => part.trim()).filter(Boolean))]
      const selected = tokens.map((token) => {
        const numeric = /^\d+$/.test(token) ? Number(token) - 1 : -1
        return numeric >= 0 ? question.options?.[numeric]?.label : question.options?.find(option => option.label === token)?.label
      })
      const choices = [...new Set(selected.filter((label): label is string => label !== undefined))]
      if (tokens.length > 1 && !question.multiSelect && choices.length === tokens.length) {
        await options.send(entry.binding.messageId, '这是单选题，请只回复一个选项。', randomUUID(), entry.binding.signal)
        return true
      }
      const answer = choices.length === tokens.length && choices.length > 0
        ? { id: question.id, selected: choices } : { id: question.id, selected: [], custom: text.trim() }
      entry.answers.push(answer)
      if (entry.answers.length === entry.questions.length) {
        pending = undefined
        entry.resolve({ answers: entry.answers })
      } else await present(entry)
      return true
    },
    dispose() { unsubscribe(); pending?.reject(new Error('飞书连接已关闭')); pending = undefined },
  }
}
