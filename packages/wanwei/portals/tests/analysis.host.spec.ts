import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore from '@deepseek-ai/dsh-session'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import DefaultModel from '@deepseek-ai/dsh-agent-default-model'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import SettingsFile from '@deepseek-ai/dsh-settings-file'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ConnectionFetchRoute, ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, vi } from 'vitest'
import * as portals from '../src/index.ts'
import { parseAnalysisInput, analysisPrompt } from '../src/analysis.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const input = {
  action: 'qa',
  item: { id: 'a1', type: 'article', title: '规划监测', summary: '摘要', body: ['建设规划实施监测网络。'] },
  question: '核心要点是什么', history: [],
}

async function fixture(script: ConstructorParameters<typeof MockAdapter>[0], timeout = 3000) {
  const root = await mkdtemp(join(tmpdir(), 'forum-analysis-'))
  const ctx = new Context()
  const events: SessionEvent[] = []
  const adapter = new MockAdapter(script)
  let route: ConnectionFetchRoute | undefined
  const builtin = {
    sessions: SessionStore, llm: LlmRuntime, agents: AgentRegistry, loop: AgentLoop,
    defaults: DefaultModel, prompt: SystemPrompt, tools: Tools, file: SettingsFile, portals,
    transport: { apply(scope: Context) {
      scope.provide('wanweiForumBilling', { quote: async () => ({ credits: 1, version: 1, cached: false, action: 'qa' }),
        run: async (_input, _signal, execute) => execute() })
      scope.provide('connection', { fetch: { register(value: ConnectionFetchRoute) {
        route = value
        return async () => { route = undefined }
      } } } as never)
      scope.on('session/event', (_session, event) => { events.push(event) })
    } },
  }
  await writeFile(join(root, 'cordis.yml'), [
    '- name: transport', '- name: file', `  config: { path: ${JSON.stringify(join(root, 'settings.json'))}, watch: false }`,
    '- name: sessions', '- name: llm', '- name: agents', '- name: prompt', '- name: tools', '- name: loop',
    '- name: defaults', '  config: { provider: mock, model: desktop-a }',
    '- name: portals', `  config: { requestTimeoutMs: ${timeout}, maxConcurrentAnalyses: 1 }`,
  ].join('\n') + '\n')
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(name: string) { return builtin[name as keyof typeof builtin] } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(root, 'cordis.yml')).href } })
  await ctx.loader.await()
  ctx.llm.registerAdapter(['mock'], adapter)
  return {
    ctx, adapter, events,
    stream: (signal: AbortSignal) => route!.fetch(new Request('http://localhost/api/desktop-forum/stream', {
      method: 'POST', body: JSON.stringify(input), signal,
    })),
    call: async (value: unknown = input, signal = new AbortController().signal) => {
      const response = await route!.fetch(new Request('http://localhost/api/desktop-forum/stream', {
        method: 'POST', body: JSON.stringify(value), signal,
      }))
      const frames = (await response.text()).trim().split('\n')
        .map(line => JSON.parse(line) as { result?: ConnectionRpcResult<unknown> })
      return frames.at(-1)!.result
    },
    hasRoute: () => route !== undefined,
    dispose: async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) },
  }
}

it('uses the current desktop model for each question and logs article, history and a tool-free prompt', async () => {
  const h = await fixture([textResponse('监测网络是本文重点。'), textResponse('第二次回答')])
  try {
    expect(await h.call()).toMatchObject({ ok: true, value: { model: 'desktop-a', text: '监测网络是本文重点。' } })
    await h.ctx.agentDefaultModel.saveSelection({ provider: 'mock', model: 'desktop-b' })
    expect(await h.call({ ...input, history: [{ role: 'assistant', text: '上一轮回答' }] }))
      .toMatchObject({ ok: true, value: { model: 'desktop-b' } })
    expect(h.adapter.requests.map(request => request.model)).toEqual(['desktop-a', 'desktop-b'])
    expect(h.adapter.requests[0]!.tools ?? []).toEqual([])
    expect(h.adapter.requests[0]!.system).toBe(analysisPrompt)
    expect(h.events.filter(event => event.type === 'user/message').map(event => event.data))
      .toMatchObject([{ content: [{ text: JSON.stringify(input) }] }, { content: [{ text: expect.stringContaining('上一轮回答') as unknown }] }])
    expect(h.events.filter(event => event.type === 'request/header').map(event => event.data))
      .toMatchObject([{ header: { config: { model: 'desktop-a' } } }, { header: { config: { model: 'desktop-b' } } }])
    expect({ input, system: analysisPrompt, answer: '监测网络是本文重点。' }).toMatchSnapshot()
  } finally { await h.dispose() }
  expect(h.hasRoute()).toBe(false)
})

it('rejects missing body and oversized input before model entry', async () => {
  const h = await fixture([])
  try {
    expect(await h.call({ ...input, item: { ...input.item, body: [] } })).toMatchObject({ ok: false })
    expect(await h.call({ ...input, question: 'x'.repeat(100001) })).toMatchObject({ ok: false })
    expect(h.adapter.requests).toHaveLength(0)
    expect(h.events.some(event => event.type === 'user/message')).toBe(false)
    expect(() => parseAnalysisInput(input, { maxInputChars: JSON.stringify(input).length - 1, maxHistoryMessages: 20 })).toThrow('长度限制')
    expect(parseAnalysisInput(input, { maxInputChars: JSON.stringify(input).length, maxHistoryMessages: 0 })).toEqual(input)
  } finally { await h.dispose() }
})

it('uses the desktop selector override independently of the global default and excludes it from article text', async () => {
  const h = await fixture([textResponse('当前聊天模型回答')])
  try {
    expect(await h.call({ ...input, selection: { provider: 'mock', model: 'chat-selected' } }))
      .toMatchObject({ ok: true, value: { model: 'chat-selected' } })
    expect(h.adapter.requests[0]!.model).toBe('chat-selected')
    expect(h.ctx.agentDefaultModel.currentSelection().model).toBe('desktop-a')
    expect(await h.call({ ...input, selection: { provider: 'mock', model: 1 } })).toMatchObject({ ok: false })
    expect(h.adapter.requests).toHaveLength(1)
  } finally { await h.dispose() }
})

it('cancels a live model request, refuses concurrent work, and releases capacity', async () => {
  const h = await fixture(['hang', textResponse('重试成功')])
  try {
    const controller = new AbortController()
    const pending = h.call(input, controller.signal)
    await vi.waitFor(() => { expect(h.adapter.requests).toHaveLength(1) })
    expect(await h.call()).toMatchObject({ ok: false })
    controller.abort()
    expect(await pending).toMatchObject({ ok: false })
    expect(h.adapter.requests[0]!.signal?.aborted).toBe(true)
    expect(await h.call()).toMatchObject({ ok: true })
  } finally { await h.dispose() }
})

it('times out stalled model work and drains it on plugin disposal', async () => {
  const h = await fixture(['hang'], 100)
  try {
    expect(await h.call()).toMatchObject({ ok: false, error: { message: expect.stringContaining('超时') as unknown } })
    expect(h.adapter.requests[0]!.signal?.aborted).toBe(true)
  } finally { await h.dispose() }
})

it('streams logged text chunks before the completed answer and requires no client price confirmation', async () => {
  const h = await fixture([textResponse('流式回答')])
  try {
    const response = await h.stream(new AbortController().signal)
    const rows = (await response.text()).trim().split('\n').map(line => JSON.parse(line) as { type: string; text?: string })
    expect(rows.some(row => row.type === 'delta' && row.text === '流式回答')).toBe(true)
    expect(rows.at(-1)).toMatchObject({ type: 'result', result: { ok: true, value: { text: '流式回答' } } })
  } finally { await h.dispose() }
})
