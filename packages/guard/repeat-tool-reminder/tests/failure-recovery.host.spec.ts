import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture, defineTool, ToolArgsError } from '@deepseek-ai/dsh-tools'
import * as Guard from '../src/index.ts'
import type { Config } from '../src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

async function withComposition(run: (ctx: Context) => Promise<void>, config: Config = {}) {
  const root = await mkdtemp(join(tmpdir(), 'failure-recovery-'))
  const ctx = new Context()
  try {
    await writeFile(join(root, 'cordis.yml'), [
      '- name: test-spine', '- name: test-loop', '  config:', '    agents: []',
      '- name: test-guard', `  config: ${JSON.stringify(Object.assign({ failureRecovery: true }, config))}`, '',
    ].join('\n'))
    ctx.baseUrl = `${pathToFileURL(root).href}/`
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['test-spine', { name: 'test-spine', apply: mountAgentLoopTestDependencies }],
      ['test-loop', AgentLoop], ['test-guard', Guard],
    ])
    ctx.loader.internal = { version: 'v2', async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`Unexpected plugin ${specifier}`)
      return modules.get(specifier)
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(root, 'cordis.yml')).href } })
    await ctx.loader.await()
    expect('default' in Guard).toBe(false)
    await run(ctx)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}

describe('Loader-composed failure recovery', () => {
  it('remembers invalid edits across reads, suppresses only unchanged retries and allows real corrections', async () => {
    await withComposition(async (ctx) => {
      const edit = vi.fn(async (args: unknown) => {
        const values = args as { old_string: string; new_string: string }
        if (values.old_string === values.new_string) throw new Error('old_string and new_string must differ')
        return [{ type: 'text' as const, text: 'updated' }]
      })
      ctx.tools.register(defineContentToolFixture({ name: 'edit', description: 'edit', parameters: {}, execute: edit }))
      ctx.tools.register(defineContentToolFixture({ name: 'read', description: 'read', parameters: {},
        async execute() { return [{ type: 'text', text: 'original' }] } }))
      const invalid = { file_path: 'result.txt', old_string: 'original', new_string: 'original' }
      const adapter = new MockAdapter([
        toolCallResponse('e1', 'edit', invalid), toolCallResponse('r1', 'read', {}),
        toolCallResponse('e2', 'edit', invalid), toolCallResponse('r2', 'read', {}),
        toolCallResponse('e3', 'edit', invalid), toolCallResponse('r3', 'read', {}),
        toolCallResponse('e4', 'edit', invalid),
        toolCallResponse('fixed', 'edit', { ...invalid, new_string: 'corrected' }), textResponse('done'),
      ])
      ctx.llm.registerAdapter(['mock'], adapter)
      const agent = ctx.agentLoop.create(SessionId('recovery'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await agent.whenIdle()
      expect(edit).toHaveBeenCalledTimes(4)
      const results = agent.session.events.filter(event => event.type === 'tool/result')
      expect(JSON.stringify(results)).toContain('本次未执行')
      const notices = agent.session.events.filter(event => event.type === 'user/message'
        && event.data.source.kind === 'plugin' && event.data.source.plugin === 'repeat-tool-reminder')
      expect(notices).toHaveLength(3)
      expect(JSON.stringify(notices[0])).toContain('新旧文本完全相同')
      expect(JSON.stringify(notices[1])).toContain('中间的其他调用不代表问题已经解决')
      expect(JSON.stringify(agent.session.events)).toContain('updated')
      expect(agent.session.events.some(event => event.type === 'turn/end')).toBe(true)
      expect(adapter.requests).toHaveLength(9)
      // Prior-turn suppression does not carry over after idle.
      const direct = await ctx.tools.execute({ agent, name: 'edit', arguments: invalid,
        callId: ToolCallId('next-turn'), signal: new AbortController().signal })
      expect(direct.isError).toBe(true)
      expect(edit).toHaveBeenCalledTimes(5)
    })
  })

  it('keeps transient failures retryable, allows success, and leaves successful polling untouched', async () => {
    await withComposition(async (ctx) => {
      let attempts = 0
      const request = vi.fn(async () => {
        if (++attempts <= 4) throw new Error('connection timed out')
        return [{ type: 'text' as const, text: 'ok' }]
      })
      ctx.tools.register(defineContentToolFixture({ name: 'request', description: 'request', parameters: {}, execute: request }))
      ctx.llm.registerAdapter(['mock'], new MockAdapter([
        ...Array.from({ length: 7 }, (_, i) => toolCallResponse(`r${i}`, 'request', {})), textResponse('done'),
      ]))
      const agent = ctx.agentLoop.create(SessionId('transient'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await agent.whenIdle()
      expect(request).toHaveBeenCalledTimes(7)
      expect(JSON.stringify(agent.session.events)).not.toContain('本次未执行')
      const recovery = agent.session.events.filter(event => event.type === 'user/message'
        && JSON.stringify(event.data.source).includes('纠错引导'))
      expect(recovery).toHaveLength(4)
    })
  })

  it('suppresses generic INVALID_ARGS without depending on a skill or a tool name', async () => {
    await withComposition(async (ctx) => {
      const execute = vi.fn(async () => { throw new ToolArgsError(['count must be an integer']) })
      ctx.tools.register(defineContentToolFixture({ name: 'custom_skill_tool', description: 'custom', parameters: {}, execute }))
      const agent = ctx.agentLoop.create(SessionId('generic'), { provider: 'mock', model: 'mock' })
      const invoke = (id: string, args: unknown, target = agent) => ctx.tools.execute({
        agent: target, name: 'custom_skill_tool', arguments: args, callId: ToolCallId(id),
        signal: new AbortController().signal,
      })
      await invoke('one', { count: 'a' })
      await invoke('two', { count: 'a' })
      await invoke('three', { count: 'a' })
      const blocked = await invoke('four', { count: 'a' })
      expect(JSON.stringify(blocked.content)).toContain('本次未执行')
      expect(execute).toHaveBeenCalledTimes(3)
      await invoke('changed', { count: 2 })
      expect(execute).toHaveBeenCalledTimes(4)
      const changed = await invoke('changed-again', { count: 3 })
      expect(JSON.stringify(changed.additionalContexts)).toContain('虽然参数不同')
      const other = ctx.agentLoop.create(SessionId('other'), { provider: 'mock', model: 'mock' })
      await invoke('other', { count: 'a' }, other)
      expect(execute).toHaveBeenCalledTimes(6)
    })
  })

  it('honors exclusions and bounds failure memory', async () => {
    await withComposition(async (ctx) => {
      const execute = vi.fn(async () => { throw new ToolArgsError(['invalid']) })
      ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'probe', parameters: {}, execute }))
      ctx.tools.register(defineContentToolFixture({ name: 'skip', description: 'skip', parameters: {}, execute }))
      const agent = ctx.agentLoop.create(SessionId('bounded'), { provider: 'mock', model: 'mock' })
      const invoke = (name: string, n: number) => ctx.tools.execute({ agent, name, arguments: { n },
        callId: ToolCallId(`${name}-${execute.mock.calls.length}`), signal: new AbortController().signal })
      for (let i = 0; i < 4; i++) await invoke('skip', 1)
      for (let i = 0; i < 3; i++) await invoke('probe', 1)
      await invoke('probe', 2)
      await invoke('probe', 1)
      expect(execute).toHaveBeenCalledTimes(9)
      for (let i = 0; i < 2; i++) await invoke('probe', 1)
      expect(JSON.stringify((await invoke('probe', 1)).content)).toContain('本次未执行')
    }, { exclude: ['skip'], failureMemorySize: 1 })
  })

  it('unmounts recovery without changing the tool or requiring a loop restart', async () => {
    await withComposition(async (ctx) => {
      const fiber = await ctx.plugin(Guard, { failureRecovery: true })
      const execute = vi.fn(async () => { throw new ToolArgsError(['invalid']) })
      ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'probe', parameters: {}, execute }))
      const agent = ctx.agentLoop.create(SessionId('dispose'), { provider: 'mock', model: 'mock' })
      const invoke = () => ctx.tools.execute({ agent, name: 'probe', arguments: {},
        callId: ToolCallId(`call-${execute.mock.calls.length}`), signal: new AbortController().signal })
      for (let i = 0; i < 3; i++) await invoke()
      expect(JSON.stringify((await invoke()).content)).toContain('本次未执行')
      await fiber.dispose()
      expect(JSON.stringify((await invoke()).content)).not.toContain('本次未执行')
      expect(execute).toHaveBeenCalledTimes(4)
    }, { failureRecovery: false })
  })

  it('coaches structured process failures without blocking retries or mistaking output text for status', async () => {
    await withComposition(async (ctx) => {
      let attempts = 0
      ctx.tools.register(defineTool({ name: 'shell', description: 'shell', parameters: {},
        output: { schema: { type: 'json' }, render: () => [{ type: 'text', text: 'ordinary output' }] },
        async execute() {
          return { kind: 'foreground', exitCode: ++attempts <= 4 ? 1 : 0, timedOut: false, aborted: false }
        },
      }))
      const agent = ctx.agentLoop.create(SessionId('process'), { provider: 'mock', model: 'mock' })
      for (let i = 0; i < 5; i++) {
        const result = await ctx.tools.execute({ agent, name: 'shell', arguments: {},
          callId: ToolCallId(`shell-${i}`), signal: new AbortController().signal })
        expect(result.isError).toBe(false)
        expect(result.additionalContexts?.length ?? 0).toBe(i < 4 ? 1 : 0)
      }
      expect(attempts).toBe(5)
    }, { thresholds: [8] })
  })
})
