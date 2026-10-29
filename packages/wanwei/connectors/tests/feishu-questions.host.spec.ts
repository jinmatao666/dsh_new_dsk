import { Context } from '@deepseek-ai/cordis'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { installFeishuQuestions } from '../src/feishu-questions.ts'

function fixture() {
  const ctx = new Context()
  const controller = new AbortController()
  const send = vi.fn(async () => {})
  const verify = vi.fn(async () => {})
  let localResolve!: (answer: AskUserQuestionAnswer) => void
  let desktopSignal: AbortSignal | undefined
  ctx.on('user-questions/request', (request) => {
    desktopSignal = request.signal
    return new Promise<AskUserQuestionAnswer>((resolve, reject) => {
      localResolve = resolve
      request.signal?.addEventListener('abort', () => { reject(new Error('desktop closed')) }, { once: true })
    })
  })
  const bridge = installFeishuQuestions(ctx, {
    binding: () => ({ sessionId: SessionId('bound'), messageId: 'om_owner', signal: controller.signal }), verify, send,
  })
  const ask = (questions: AskUserQuestionRequest['questions'], id = 'bound') => ctx.waterfall('user-questions/request', {
    agent: { session: { id: SessionId(id) } } as AskUserQuestionRequest['agent'], questions,
  }, async () => ({ answers: [] }))
  return { ctx, bridge, controller, send, verify, ask, local: (answer: AskUserQuestionAnswer) => { localResolve(answer) },
    signal: () => desktopSignal }
}
it('accepts mobile selections and free text across questions, then dismisses the desktop form', async () => {
  const f = fixture()
  try {
    const result = f.ask([{ id: 'scope', question: '新闻范围？', options: [{ label: '国内新闻' }, { label: '国际新闻' }] },
      { id: 'extra', question: '补充要求？' }])
    await vi.waitFor(() => { expect(f.bridge.hasPending()).toBe(true) })
    expect(await f.bridge.answer('1')).toBe(true)
    expect(f.bridge.hasPending()).toBe(true)
    expect(await f.bridge.answer('侧重人工智能')).toBe(true)
    expect(await result).toEqual({ answers: [{ id: 'scope', selected: ['国内新闻'] }, { id: 'extra', selected: [], custom: '侧重人工智能' }] })
    expect(f.signal()?.aborted).toBe(true)
    expect(await f.bridge.answer('过期回答')).toBe(false)
    expect(f.send).toHaveBeenCalledTimes(2)
  } finally { f.bridge.dispose(); await f.ctx.fiber.dispose() }
})
it('keeps unrelated questions local and lets a desktop answer win the same request', async () => {
  const f = fixture()
  try {
    const unrelated = f.ask([{ id: 'other', question: 'other' }], 'unrelated')
    f.local({ answers: [{ id: 'other', selected: [], custom: 'local only' }] })
    await unrelated
    expect(f.send).not.toHaveBeenCalled()
    const result = f.ask([{ id: 'scope', question: '范围？' }])
    await vi.waitFor(() => { expect(f.bridge.hasPending()).toBe(true) })
    const answer = { answers: [{ id: 'scope', selected: [], custom: '国内新闻' }] }
    f.local(answer)
    expect(await result).toEqual(answer)
    expect(await f.bridge.answer('国际新闻')).toBe(false)
  } finally { f.bridge.dispose(); await f.ctx.fiber.dispose() }
})
it('handles multi-selection, rejects single-choice ambiguity and cancels on disconnect', async () => {
  const f = fixture()
  try {
    const first = f.ask([{ id: 'scope', question: '范围？', options: [{ label: '国内' }, { label: '国际' }] }])
    await vi.waitFor(() => { expect(f.bridge.hasPending()).toBe(true) })
    await f.bridge.answer('1,2')
    expect(f.bridge.hasPending()).toBe(true)
    await f.bridge.answer('国内')
    await first
    const second = f.ask([{ id: 'scope', question: '范围？', multiSelect: true, options: [{ label: '国内' }, { label: '国际' }] }])
    await vi.waitFor(() => { expect(f.bridge.hasPending()).toBe(true) })
    await f.bridge.answer('1,2')
    expect(await second).toEqual({ answers: [{ id: 'scope', selected: ['国内', '国际'] }] })
    const last = f.ask([{ id: 'last', question: '继续？' }])
    const rejected = expect(last).rejects.toThrow('取消')
    f.controller.abort()
    await rejected
    expect(f.bridge.hasPending()).toBe(false)
  } finally { f.bridge.dispose(); await f.ctx.fiber.dispose() }
})
