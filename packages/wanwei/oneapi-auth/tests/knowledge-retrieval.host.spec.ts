import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { KnowledgeBaseApi } from '../src/knowledge-base.ts'
import {
  installKnowledgeRetrieval,
  KNOWLEDGE_RETRIEVAL_PLUGIN,
  renderRetrievalContext,
  type KnowledgeRetrievalOptions,
  type KnowledgeRetrievalSource,
} from '../src/knowledge-retrieval.ts'

const options: KnowledgeRetrievalOptions = { pageSize: 8, similarityThreshold: 0.2, maxContextChars: 2000, timeoutMs: 1000 }

async function harness(source: KnowledgeRetrievalSource) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry); await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter([textResponse('answer'), textResponse('second')])
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin((child: Context) => { installKnowledgeRetrieval(child, source, options) })
  const { agent } = await ctx.agents.create({ sessionId: SessionId('kb-session'), agentOptions: { provider: 'mock', model: 'mock' } })
  const ask = async (text: string) => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await vi.waitFor(() => { expect(agent.status).toBe('idle') })
    await agent.whenIdle()
  }
  const injected = () => agent.session.events.flatMap(event => event.type === 'user/message'
    && event.data.source.kind === 'plugin' && event.data.source.plugin === KNOWLEDGE_RETRIEVAL_PLUGIN ? [event.data] : [])
  return { ctx, adapter, ask, injected }
}

describe('composer knowledge retrieval', () => {
  let dispose: (() => Promise<void>) | undefined
  afterEach(async () => { await dispose?.(); dispose = undefined })

  it('logs retrieved chunks after the user question and sends them to the model', async () => {
    const retrieve = vi.fn<KnowledgeRetrievalSource['retrieve']>(async () => [
      { content: '报销需在 30 日内提交。', documentName: '财务制度.pdf', knowledgeBaseName: '制度库', similarity: 0.9 },
    ])
    const { ctx, adapter, ask, injected } = await harness({ scopeOf: () => [3, 7], retrieve })
    dispose = () => ctx.fiber.dispose()
    await ask('报销期限是多久？')
    expect(retrieve).toHaveBeenCalledWith([3, 7], '报销期限是多久？', options, expect.any(AbortSignal))
    const [message] = injected()
    expect(message?.source).toMatchObject({ form: 'notice', summary: '知识库检索：引用 1 条参考资料' })
    const text = message?.content[0]?.type === 'text' ? message.content[0].text : ''
    expect(text).toContain('[1] 来源：《财务制度.pdf》（知识库：制度库）\n报销需在 30 日内提交。')
    expect(JSON.stringify(adapter.requests[0]!.messages)).toContain('报销需在 30 日内提交。')
  })

  it('leaves turns untouched when the Session has no library scope', async () => {
    const retrieve = vi.fn<KnowledgeRetrievalSource['retrieve']>()
    const { ctx, ask, injected } = await harness({ scopeOf: () => undefined, retrieve })
    dispose = () => ctx.fiber.dispose()
    await ask('普通问题')
    expect(retrieve).not.toHaveBeenCalled()
    expect(injected()).toEqual([])
  })

  it('tells the model when retrieval fails instead of failing the turn', async () => {
    const { ctx, adapter, ask, injected } = await harness({
      scopeOf: () => [3],
      retrieve: async () => { throw new Error('无权使用所选知识库') },
    })
    dispose = () => ctx.fiber.dispose()
    await ask('问题')
    expect(injected()[0]?.source).toMatchObject({ summary: '知识库检索失败' })
    expect(adapter.requests).toHaveLength(1)
  })
})

describe('renderRetrievalContext', () => {
  it('states an empty result and bounds chunk text', () => {
    expect(renderRetrievalContext([], 100)).toMatchObject({ count: 0 })
    const rendered = renderRetrievalContext([
      { content: 'a'.repeat(8), documentName: '', knowledgeBaseName: '库', similarity: 1 },
      { content: 'b'.repeat(8), documentName: 'x', knowledgeBaseName: '库', similarity: 1 },
    ], 5)
    expect(rendered.count).toBe(1)
    expect(rendered.text).toContain('《未命名文件》')
    expect(rendered.text).toContain('aaaaa…')
    expect(rendered.text).not.toContain('b')
  })
})

describe('KnowledgeBaseApi retrieval', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('stores Session scopes and posts retrieval with the selected libraries', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({
      success: true, data: { chunks: [{ content: '正文', document_name: 'a.pdf', knowledge_base_name: '库', similarity: 0.4 }] },
    }))
    vi.stubGlobal('fetch', fetch)
    const api = new KnowledgeBaseApi('http://oneapi', async () => 'token', 1000)
    const signal = new AbortController().signal
    await api.call('retrieval-scope', { sessionId: 's1', ids: [3, 3, 7] }, signal)
    expect(api.scopeOf('s1')).toEqual([3, 7])
    await expect(api.call('retrieval-scope', { sessionId: 's1', ids: [0] }, signal)).rejects.toThrow('知识库编号无效')
    expect(await api.retrieve([3, 7], '问题', options, signal)).toEqual([
      { content: '正文', documentName: 'a.pdf', knowledgeBaseName: '库', similarity: 0.4 },
    ])
    expect(fetch.mock.calls[0]![0]).toBe('http://oneapi/api/knowledge-bases/retrieval')
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({
      knowledge_base_ids: [3, 7], question: '问题', page_size: 8, similarity_threshold: 0.2,
    })
    await api.call('retrieval-scope', { sessionId: 's1', ids: [] }, signal)
    expect(api.scopeOf('s1')).toBeUndefined()
    await api.dispose()
  })
})
