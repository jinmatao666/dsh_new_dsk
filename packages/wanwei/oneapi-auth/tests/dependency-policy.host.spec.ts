import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { existsSync } from 'node:fs'
import { installNetworkPolicy } from '../src/network.ts'
import { DEPENDENCY_BLOCKED, INTRANET_DEPENDENCY_GUIDANCE, dependencyFailure, requiresPublicDependencies, shellInput } from '../src/dependency-policy.ts'

vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>(), existsSync: vi.fn(() => false) }))
afterEach(() => { vi.unstubAllEnvs(); vi.mocked(existsSync).mockReturnValue(false) })

class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}
  get writable() { return true }
  protected load() { return Promise.resolve(this.doc) }
  protected persist(ns: SettingsNamespace, value: Record<string, unknown>) {
    this.doc[ns] = structuredClone(value); return Promise.resolve()
  }
}

describe('Intranet dependency feedback', () => {
  it.each(['pip install pandas', 'python -m pip install -r requirements.txt', 'npm ci', 'pnpm add x',
    'yarn install', 'echo done\npip install pandas', 'pip install --no-index https://pypi.org/x.whl'])('rejects public download: %s', (command) => {
    vi.stubEnv('PIP_INDEX_URL', 'https://pypi.org/simple'); vi.stubEnv('PIP_EXTRA_INDEX_URL', '')
    vi.stubEnv('npm_config_registry', 'https://registry.npmjs.org')
    expect(requiresPublicDependencies(command, [])).toBe(true)
  })
  it.each(['python script.py', 'pip install --no-index ./pkg.whl', 'npm install --offline ./pkg.tgz',
    'pip install -i http://10.0.0.2/simple pandas', 'npm install --registry=http://registry.lan x',
    'echo "pip install pandas"', 'pip install -i "$INTERNAL_INDEX" pandas'])('keeps local/internal operations: %s', (command) => {
    vi.stubEnv('PIP_INDEX_URL', 'https://pypi.org/simple'); vi.stubEnv('PIP_EXTRA_INDEX_URL', '')
    expect(requiresPublicDependencies(command, [])).toBe(false)
  })
  it('lets package managers resolve their configured internal mirrors', () => {
    vi.stubEnv('PIP_INDEX_URL', 'http://packages.lan/simple'); vi.stubEnv('PIP_EXTRA_INDEX_URL', '')
    expect(requiresPublicDependencies('pip install pandas', [])).toBe(false)
    vi.stubEnv('PIP_INDEX_URL', '')
    vi.mocked(existsSync).mockReturnValue(true)
    expect(requiresPublicDependencies('pip install pandas', [])).toBe(false)
  })
  it('recognizes missing dependencies without treating every script failure as networking', () => {
    expect(dependencyFailure("ModuleNotFoundError: No module named 'pandas'")).toBe(true)
    expect(dependencyFailure('npm ERR! EAI_AGAIN registry.npmjs.org')).toBe(true)
    expect(dependencyFailure('SyntaxError: invalid syntax')).toBe(false)
    expect(shellInput('write', { command: 'pip install x' })).toBeUndefined()
    expect(shellInput('terminal_send', { text: 'pip install x' })).toBe('pip install x')
  })
  it('returns the same tool feedback to the conversation/model and restores Internet behavior on mode changes and unload', async () => {
    vi.stubEnv('PIP_INDEX_URL', 'https://pypi.org/simple'); vi.stubEnv('PIP_EXTRA_INDEX_URL', '')
    const ctx = new Context()
    await ctx.plugin(MemorySettings); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
    const execute = vi.fn(async () => "ModuleNotFoundError: No module named 'pandas'")
    ctx.tools.register(defineTool({ name: 'bash', description: 'shell', parameters: {
      command: { type: 'string', required: true },
    }, output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] }, execute }))
    let policy!: ReturnType<typeof installNetworkPolicy>
    const fiber = await ctx.plugin({ name: 'test-network', inject: ['settings'], apply: (ctx: Context) => {
      policy = installNetworkPolicy(ctx, 'http://server.lan')
    } })
    const call = (command: string) => ctx.tools.execute({ name: 'bash', callId: ToolCallId(command),
      arguments: { command }, signal: new AbortController().signal })
    await policy.setMode('intranet')
    const denied = await call('pip install pandas')
    expect(denied.isError).toBe(true)
    expect(denied.content).toEqual([{ type: 'text', text: `Error: ${DEPENDENCY_BLOCKED}` }])
    expect(execute).not.toHaveBeenCalled()
    const missing = await call('python script.py')
    expect(missing.content).toContainEqual({ type: 'text', text: `\n${DEPENDENCY_BLOCKED}` })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain(INTRANET_DEPENDENCY_GUIDANCE)
    await policy.setMode('internet')
    const internet = await call('pip install pandas')
    expect(internet.content).not.toContainEqual({ type: 'text', text: `\n${DEPENDENCY_BLOCKED}` })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain(INTRANET_DEPENDENCY_GUIDANCE)
    await fiber.dispose()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain(INTRANET_DEPENDENCY_GUIDANCE)
    expect((await call('pip install pandas')).isError).toBe(false)
    await ctx.fiber.dispose()
  })
})
