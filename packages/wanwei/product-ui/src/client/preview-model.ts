import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'

/** Correlate a preview edit with its own submitted prompt, never another turn's answer.
 * @param sessions - Public session registry.
 * @param sessionId - Session selected when the action began.
 * @param prompt - Explicit transformation or chart request.
 * @param signal - Workspace/action disposal signal.
 * @returns Text from the identified request's completed turn.
 */
export async function requestPreviewText(sessions: ISessions, sessionId: Parameters<ISessions['binding']>[0], prompt: string, signal: AbortSignal): Promise<string> {
  const binding = sessions.binding(sessionId)
  if (!binding) throw new Error('当前会话不可用')
  if (binding.session.getSnapshot().running) throw new Error('请等待当前任务完成后再编辑')
  const submission = binding.session.beginSubmission({ text: prompt, images: [] })
  return new Promise<string>((resolve, reject) => {
    let settled = false
    let unsubscribe = () => {}
    const finish = (text?: string, reason?: unknown) => {
      if (settled) return
      settled = true; unsubscribe(); clearTimeout(timeout); signal.removeEventListener('abort', abort)
      if (reason) { submission.abandon(); reject(reason) } else resolve(text ?? '')
    }
    const abort = () => finish(undefined, new Error('预览编辑已取消'))
    const timeout = setTimeout(() => finish(undefined, new Error('模型响应超时，请重试')), 180_000)
    const inspect = () => {
      let turn: number | undefined
      let ownTurn: number | undefined
      let answer = ''
      for (const entry of binding.eventSource.getSnapshot().entries) {
        if (entry.type !== 'event') continue
        const event = entry.event
        if (event.type === 'turn/start') turn = event.data.turn
        if (event.type === 'step/start') turn = event.data.turn
        if (event.type === 'user/message') {
          const source = event.data.source as { rpcId?: string }
          if (source.rpcId === submission.requestId) ownTurn = turn
        }
        if (ownTurn === undefined) continue
        if (event.type === 'assistant/message' && event.data.turn === ownTurn && !event.data.interrupted) {
          const text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
          if (text) answer = text
        }
        if (event.type === 'turn/end' && event.data.turn === ownTurn) {
          if (event.data.reason.kind !== 'completed' || !answer.trim()) finish(undefined, new Error('模型未返回完整编辑结果'))
          else finish(answer)
          return
        }
      }
    }
    unsubscribe = binding.eventSource.subscribe(inspect)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    void binding.session.prompt([{ type: 'text', text: prompt }], 'queue', signal, submission.requestId)
      .then((result) => { if (!result.ok) finish(undefined, new Error(result.error.message)); else inspect() })
      .catch(reason => finish(undefined, reason))
  })
}
