/** Desktop knowledge retrieval: per-Session library scope and pre-step reference context for model turns. */

import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

/** Plugin name recorded on injected retrieval messages. */
export const KNOWLEDGE_RETRIEVAL_PLUGIN = 'wanwei-knowledge-retrieval'

/** Maximum libraries one Session may search per question; OneAPI enforces the same bound. */
export const MAX_RETRIEVAL_LIBRARIES = 20

/** One chunk returned by OneAPI `POST /api/knowledge-bases/retrieval`. */
export interface RetrievedKnowledgeChunk {
  content: string
  documentName: string
  knowledgeBaseName: string
  similarity: number
}

/** Deployment bounds for one retrieval. */
export interface KnowledgeRetrievalOptions {
  /** Chunks requested from RAGFlow, 1..30. */
  pageSize: number
  /** RAGFlow similarity floor, 0..1. */
  similarityThreshold: number
  /** Upper bound on chunk text characters injected into one turn. */
  maxContextChars: number
  /** Complete retrieval request timeout in milliseconds. */
  timeoutMs: number
}

/** Retrieval capability supplied by the authenticated OneAPI client. */
export interface KnowledgeRetrievalSource {
  /** @param sessionId - Host Session id. @returns Selected library ids, or undefined when retrieval is off. */
  scopeOf(sessionId: string): readonly number[] | undefined
  /**
   * @param ids - Selected library ids.
   * @param question - User question text.
   * @param options - Retrieval bounds.
   * @param signal - Turn cancellation combined with the retrieval timeout.
   * @returns Chunks ordered by relevance.
   */
  retrieve(ids: readonly number[], question: string, options: KnowledgeRetrievalOptions,
    signal: AbortSignal): Promise<RetrievedKnowledgeChunk[]>
}

/** Text of the newest browser-authored message proposed for this step. */
function latestUserQuestion(messages: readonly UserMessage[]): string {
  for (const message of [...messages].reverse()) {
    if (message.source.kind !== 'user') continue
    const text = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
    if (text !== '') return text
  }
  return ''
}

/**
 * Render retrieved chunks as model-facing reference text within the character budget.
 * @param chunks - Chunks ordered by relevance.
 * @param maxChars - Upper bound on chunk text characters.
 * @returns Reference text and the number of chunks it contains.
 */
export function renderRetrievalContext(chunks: readonly RetrievedKnowledgeChunk[], maxChars: number): { text: string; count: number } {
  if (chunks.length === 0) {
    return {
      count: 0,
      text: '用户为本轮问题启用了知识库检索，但所选知识库中没有检索到与问题相关的内容。'
        + '请先明确告诉用户知识库中未找到相关资料；如需补充通用知识，请与知识库内容明确区分。',
    }
  }
  const sections: string[] = []
  let remaining = maxChars
  for (const chunk of chunks) {
    if (remaining <= 0) break
    const content = chunk.content.trim()
    const body = content.length > remaining ? `${content.slice(0, remaining)}…` : content
    remaining -= body.length
    const source = chunk.documentName === '' ? '未命名文件' : chunk.documentName
    sections.push(`[${sections.length + 1}] 来源：《${source}》（知识库：${chunk.knowledgeBaseName}）\n${body}`)
  }
  return {
    count: sections.length,
    text: '以下是根据用户本轮问题从其所选知识库中检索到的参考片段，按相关度排序。'
      + '回答时优先依据这些片段，并在引用处用“（来源：《文件名》）”注明出处；'
      + '片段不足以回答时请明确说明，再视情况补充通用知识并加以区分。\n\n'
      + sections.join('\n\n'),
  }
}

/**
 * Append retrieved knowledge to the first step of each user turn whose Session has a library scope.
 * @param ctx - Host plugin context; the listener is disposed with it.
 * @param source - Scope lookup and authenticated retrieval.
 * @param options - Deployment retrieval bounds.
 */
export function installKnowledgeRetrieval(ctx: Context, source: KnowledgeRetrievalSource,
  options: KnowledgeRetrievalOptions): void {
  ctx.on('agent/pre-step', async ({ agent, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || step !== 1 || signal.aborted) return decision
    const ids = source.scopeOf(String(agent.session.id))
    if (ids === undefined || ids.length === 0) return decision
    const question = latestUserQuestion(decision.messages)
    if (question === '') return decision
    let text: string
    let summary: string
    try {
      const chunks = await source.retrieve(ids, question, options,
        AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]))
      const rendered = renderRetrievalContext(chunks, options.maxContextChars)
      text = rendered.text
      summary = rendered.count === 0 ? '知识库检索：未找到相关内容' : `知识库检索：引用 ${rendered.count} 条参考资料`
    } catch (error) {
      signal.throwIfAborted()
      const message = error instanceof Error ? error.message : String(error)
      text = `用户为本轮问题启用了知识库检索，但检索失败：${message}。请告诉用户本次回答未能使用知识库资料。`
      summary = '知识库检索失败'
    }
    return {
      ...decision,
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: KNOWLEDGE_RETRIEVAL_PLUGIN, form: 'notice', summary },
        }),
      ],
    }
  })
}
