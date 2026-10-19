import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalJobs from '@deepseek-ai/dsh-jobs-local'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import { expect, it, vi } from 'vitest'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { installDesktopLifecycle } from '../src/desktop-lifecycle.ts'

it('vetoes real running agents, idle maintenance and product work, then waits for disposal before acknowledging', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-lifecycle-'))
  const ctx = new Context()
  const exit = vi.fn()
  ctx.provide('appExit', exit)
  let request!: () => Promise<boolean>
  let release!: () => void
  try {
    await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry); await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['mock'], new MockAdapter(['hang']))
    const file = join(directory, 'cordis.yml')
    await writeFile(file, '- name: test-update-lifecycle\n')
    ctx.baseUrl = pathToFileURL(directory).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = { version: 'v2', async import() {
      return { apply(child: Context) { request = installDesktopLifecycle(child) } }
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(file).href } })
    await ctx.loader.await()
    const { agent } = await ctx.agents.create({ sessionId: SessionId('update-test'), agentOptions: { provider: 'mock', model: 'mock' } })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Run until canceled' }], source: { kind: 'user' } }))
    expect(await request()).toBe(false)
    expect(exit).not.toHaveBeenCalled()
    expect(agent.status).toBe('running')
    agent.cancel({ kind: 'user' }); await agent.whenIdle()
    await ctx.plugin(LocalJobs)
    ctx.jobs.attachController('update-test')
    let finishJob!: (outcome: JobOutcome) => void
    const job = ctx.jobs.start({ kind: 'bash', label: 'owned background work', owner: agent,
      run: () => ({ cancel: () => { finishJob({ status: 'killed' }) }, done: new Promise((resolve) => { finishJob = resolve }) }) })
    expect(ctx.jobs.list()).toHaveLength(0)
    expect(await request()).toBe(false)
    finishJob({ status: 'completed' })
    await ctx.jobs.wait(job, 1000, agent)
    const maintenance = agent.runMaintenance(() => new Promise<void>((resolve) => { release = resolve }))
    expect(agent.status).toBe('idle')
    expect(await request()).toBe(false)
    release(); await maintenance
    const veto = ctx.on('wanwei-update/check', (check) => { check.blocked = true })
    expect(await request()).toBe(false)
    veto()
    let disposed = false
    let finishDisposal: (() => void) | undefined
    ctx.effect(() => async () => {
      await new Promise<void>((resolve) => { finishDisposal = resolve })
      disposed = true
    }, 'test: resource disposal')
    const shutdown = request()
    await expect.poll(() => finishDisposal !== undefined).toBe(true)
    expect(exit).not.toHaveBeenCalled()
    finishDisposal!()
    expect(await shutdown).toBe(true)
    expect(disposed).toBe(true)
    expect(exit).toHaveBeenCalledWith(0)
    expect(ctx.get('agents')).toBeUndefined()
    expect(await request()).toBe(false)
  } finally {
    release?.(); await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true })
  }
})
