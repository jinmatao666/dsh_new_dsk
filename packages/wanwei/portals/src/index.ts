/** Desktop portal model analysis, owned and authenticated by the Host. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-wanwei-oneapi-auth/src/forum-billing.ts'
import { parseAnalysisInput, parseAnalysisSelection, analysisPrompt } from './analysis.ts'

/** Bounds on one portal analysis and concurrent Host work. */
export interface Config {
  /** Maximum duration including agent creation and persistence flush, in milliseconds. */
  requestTimeoutMs: number
  /** Maximum serialized input characters, including article and conversation. */
  maxInputChars: number
  /** Maximum previous messages accepted for one question. */
  maxHistoryMessages: number
  /** Maximum output tokens requested from the selected model. */
  maxOutputTokens: number
  /** Maximum answer characters forwarded to the embedded page. */
  maxOutputChars: number
  /** Maximum simultaneous analyses in this Host. */
  maxConcurrentAnalyses: number
}

/** Validated deployment bounds for portal analysis. */
export const Config: z<Config> = z.object({
  requestTimeoutMs: z.natural().min(1).default(180000),
  maxInputChars: z.natural().min(1).default(100000),
  maxHistoryMessages: z.natural().default(20),
  maxOutputTokens: z.natural().min(1).default(4096),
  maxOutputChars: z.natural().min(1).default(30000),
  maxConcurrentAnalyses: z.natural().min(1).default(2),
})

/** Services used for logged, tool-free model turns and desktop RPC. */
export const inject = ['connection', 'agents', 'agentDefaultModel', 'tools', 'systemPrompt', 'sessions']

/**
 * Register analysis using the live desktop model selection; no credentials leave the Host.
 * @param ctx - Host context owning the RPC route and all running analyses.
 * @param config - Validated limits for input, output, duration and concurrency.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['wanweiForumBilling'], (billing) => {
    const active = new Set<Promise<unknown>>()
    const lifetime = new AbortController()
    billing.effect(() => () => {
      lifetime.abort()
      return Promise.allSettled([...active]).then(() => undefined)
    })
    const analyze = async (payload: unknown, callerSignal: AbortSignal, onText: (text: string) => void) => {
      const failure = (message: string) => ({ ok: false as const, error: { code: 'internal', message, details: {} } })
      if (lifetime.signal.aborted) return failure('桌面分析服务已关闭')
      if (active.size >= config.maxConcurrentAnalyses) return failure('分析任务较多，请稍后重试')
      const signal = AbortSignal.any([callerSignal, lifetime.signal, AbortSignal.timeout(config.requestTimeoutMs)])
      const run = async () => {
        const input = parseAnalysisInput(payload, config)
        signal.throwIfAborted()
        const quote = await billing.wanweiForumBilling.quote(input, signal)
        input.action = quote.action
        const version = quote.version
        const desktopSelection = parseAnalysisSelection(payload)
        const selection = desktopSelection === undefined ? ctx.agentDefaultModel.currentSelection() : {
          provider: desktopSelection.provider, model: desktopSelection.model,
          ...desktopSelection.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(desktopSelection.reasoningEffort) },
        }
        const sessionId = SessionId(randomUUID())
        const operation = { ...input, version, sessionId, provider: selection.provider, model: selection.model }
        const answer = await billing.wanweiForumBilling.run(operation, signal, async () => {
          const handle = await ctx.agents.create({
            sessionId, signal,
            agentOptions: { ...selection, maxTokens: config.maxOutputTokens },
            setup(scope) {
              scope.tools.restrict({ allow: [] })
              scope.systemPrompt.section({ name: 'portal:analysis', order: 0, complete: true, text: analysisPrompt })
              scope.on('system-prompt/assemble', async (_assembly, _context, next) => ({ ...await next(), contexts: [] }))
            },
          })
          const cancel = () => { handle.agent.cancel({ kind: 'user' }) }
          let streamed = ''
          const stopStreaming = ctx.on('session/event', (session, event) => {
            if (session.id !== sessionId) return
            if (event.type === 'request/header') { streamed = ''; onText(streamed) }
            if (event.type !== 'assistant/chunk' || event.data.chunk.type !== 'text-delta') return
            streamed += event.data.chunk.text
            if (streamed.length <= config.maxOutputChars) onText(streamed)
          })
          signal.addEventListener('abort', cancel, { once: true })
          try {
            // Pin this disposable session to the known article title so automatic
            // title generation cannot make an additional, separately billed model call.
            ctx.get('sessionTitle')?.rename(handle.agent.session, input.item.title)
            signal.throwIfAborted()
            handle.agent.followup(createUserMessage({
              content: [{ type: 'text', text: JSON.stringify(input) }], source: { kind: 'user' },
            }))
            await handle.agent.whenIdle()
            signal.throwIfAborted()
            await ctx.sessions.flush(handle.agent.session)
            signal.throwIfAborted()
            const events = handle.agent.session.events
            const end = events.findLast(event => event.type === 'turn/end')
            if (end?.type !== 'turn/end' || end.data.reason.kind !== 'completed') {
              throw new Error('模型分析未完成，请稍后重试')
            }
            const reply = events.findLast(event => event.type === 'assistant/message')
            const text = reply?.type === 'assistant/message'
              ? reply.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim() : ''
            if (!text) throw new Error('模型未返回分析内容，请重试')
            if (text.length > config.maxOutputChars) throw new Error('回答过长，请缩小问题范围后重试')
            return { text, provider: selection.provider, model: selection.model }
          } finally {
            stopStreaming()
            signal.removeEventListener('abort', cancel)
            await handle.dispose()
          }
        })
        return { ok: true as const, value: answer }
      }
      const pending = run().catch((error: unknown) => failure(signal.aborted ? '分析已取消或超时，请重试'
        : error instanceof Error && error.name === 'PortalAnalysisError' ? error.message
          : '模型分析失败，请检查桌面端模型是否可用后重试'))
      active.add(pending)
      try { return await pending } finally { active.delete(pending) }
    }
    billing.effect(() => ctx.connection.fetch.register({
      path: '/api/desktop-forum/stream', methods: ['POST'],
      async fetch(request) {
        let payload: unknown
        try { payload = await request.json() } catch { return new Response('Invalid JSON', { status: 400 }) }
        const controller = new AbortController()
        const signal = AbortSignal.any([request.signal, controller.signal])
        const encoder = new TextEncoder()
        let closed = false
        const body = new ReadableStream<Uint8Array>({
          start(stream) {
            const send = (value: object) => { if (!closed) stream.enqueue(encoder.encode(JSON.stringify(value) + '\n')) }
            void analyze(payload, signal, (text) => { send({ type: 'delta', text }) }).then((result) => {
              if (closed) return
              send({ type: 'result', result })
              closed = true
              stream.close()
            })
          },
          cancel() { closed = true; controller.abort() },
        })
        return new Response(body, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } })
      },
    }))
  })
}
