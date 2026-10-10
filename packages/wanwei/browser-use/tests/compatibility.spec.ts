import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as BrowserPlugin from '../src/index.ts'
import { browserCompatibilityContext } from '../src/index.ts'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

let ctx: Context
afterEach(async () => { await ctx?.fiber.dispose() })

async function setup() {
  ctx = new Context()
  await ctx.plugin(MemorySettings)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  const agent = { id: SessionId('browser-test'), session: Session.create(SessionId('browser-test')) } as Agent
  const scope = createScope(ctx, agent)
  Object.assign(agent, { ctx: scope.ctx })
  return { agent, scope, facade: browserCompatibilityContext(ctx) }
}

describe('official browser lifecycle compatibility', () => {
  it('defers disabled Session initialization until a later enabled request', async () => {
    const { agent, scope } = await setup()
    let allowed = false
    let starts = 0
    const facade = browserCompatibilityContext(ctx, () => allowed)
    Reflect.apply(facade.on.bind(facade), facade, ['agent/created', async () => { starts++ }])
    const unregister = ctx.agents.register(agent)
    await ctx.systemPrompt.assemble(assembleContextFor(agent))
    expect(starts).toBe(0)
    allowed = true
    await ctx.systemPrompt.assemble(assembleContextFor(agent))
    expect(starts).toBe(1)
    await scope.dispose()
    unregister()
  })
  it('mounts the official capability by default without a settings switch', async () => {
    await setup()
    await ctx.plugin(BrowserPlugin, { enabled: true, headless: false })
    expect(ctx.get('browserUse')).toBeDefined()
  })

  it('hides browser tools when disabled and restores them after a committed enable', async () => {
    await setup()
    await ctx.plugin(BrowserPlugin, { enabled: false, headless: false })
    expect(ctx.get('browserUse')).toBeDefined()
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'mcp__playwright-mcp__toggle-probe', description: 'test toggle', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { return 'ready' },
    })))
    expect(ctx.tools.schemas()).toEqual([])
    const call = { name: 'mcp__playwright-mcp__toggle-probe', arguments: {},
      callId: ToolCallId('disabled-probe'), signal: new AbortController().signal }
    expect((await ctx.tools.execute(call)).isError).toBe(true)
    await ctx.settings.update(settingsNamespace('wanwei-browser-use'), { enabled: true })
    expect(ctx.tools.schemas().map(tool => tool.name)).toContain(call.name)
    const enabledResult = await ctx.tools.execute({ ...call, callId: ToolCallId('enabled-probe') })
    // The synthetic tool has no official Session ownership; only our permission gate is exercised here.
    expect(JSON.stringify(enabledResult.content)).not.toContain('浏览器助手已停用')
    await ctx.settings.update(settingsNamespace('wanwei-browser-use'), { enabled: false })
    expect((await ctx.tools.execute(call)).isError).toBe(true)
  })

  it('denies direct browser execution in pure intranet mode', async () => {
    await setup()
    ctx.provide('wanweiNetworkPolicy', { getSnapshot: () => ({ mode: 'intranet' }) })
    await ctx.plugin(BrowserPlugin, { enabled: true, headless: true })
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'mcp__playwright-mcp__policy-probe', description: 'test policy', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { throw new Error('must not execute') },
    })))
    expect(ctx.tools.schemas()).toEqual([])
    const result = await ctx.tools.execute({
      name: 'mcp__playwright-mcp__policy-probe', arguments: {},
      callId: ToolCallId('intranet-probe'), signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
  })
  it('waits for asynchronous registration and recollects first-request tools', async () => {
    const { agent, scope, facade } = await setup()
    const gate = Promise.withResolvers<undefined>()
    let signal: AbortSignal | undefined
    Reflect.apply(facade.on.bind(facade), facade, ['agent/created', async (event: { signal: AbortSignal }) => {
      signal = event.signal
      await gate.promise
      scope.ctx.effect(() => scope.ctx.get('tools')!.register(defineTool({
        name: 'browser-test-tool', description: 'test browser initialization', parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        async execute() { return 'ready' },
      })))
    }])
    const unregister = ctx.agents.register(agent)
    let finished = false
    const assembly = ctx.systemPrompt.assemble(assembleContextFor(agent)).then((value) => {
      finished = true
      return value
    })
    await Promise.resolve()
    expect(finished).toBe(false)
    expect(signal).toBeInstanceOf(AbortSignal)
    gate.resolve(undefined)
    expect((await assembly).tools.map(tool => tool.name)).toContain('browser-test-tool')
    await scope.dispose()
    unregister()
    expect(ctx.tools.schemas().map(tool => tool.name)).not.toContain('browser-test-tool')
  })

  it('cancels a waiting turn without aborting Session initialization', async () => {
    const { agent, scope, facade } = await setup()
    const gate = Promise.withResolvers<undefined>()
    let initializationSignal: AbortSignal | undefined
    Reflect.apply(facade.on.bind(facade), facade, ['agent/created', async (event: { signal: AbortSignal }) => {
      initializationSignal = event.signal
      await gate.promise
    }])
    const unregister = ctx.agents.register(agent)
    const controller = new AbortController()
    const assembly = ctx.systemPrompt.assemble(assembleContextFor(agent, controller.signal))
    controller.abort(new Error('turn canceled'))
    await expect(assembly).rejects.toThrow('turn canceled')
    expect(initializationSignal?.aborted).toBe(false)
    gate.resolve(undefined)
    await ctx.systemPrompt.assemble(assembleContextFor(agent))
    await scope.dispose()
    expect(initializationSignal?.aborted).toBe(true)
    unregister()
  })

  it('reports failed initialization to assembly instead of admitting incomplete tools', async () => {
    const { agent, scope, facade } = await setup()
    Reflect.apply(facade.on.bind(facade), facade, ['agent/created', async () => { throw new Error('startup failed') }])
    const unregister = ctx.agents.register(agent)
    await expect(ctx.systemPrompt.assemble(assembleContextFor(agent))).rejects.toThrow('startup failed')
    await scope.dispose()
    unregister()
  })
})
