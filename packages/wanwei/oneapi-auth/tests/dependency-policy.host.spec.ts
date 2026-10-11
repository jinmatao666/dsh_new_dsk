import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { installNetworkPolicy } from '../src/network.ts'
import { DEPENDENCY_FEEDBACK, INTRANET_DEPENDENCY_GUIDANCE, dependencyFailure } from '../src/dependency-policy.ts'

class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}
  get writable() { return true }
  protected load() { return Promise.resolve(this.doc) }
  protected persist(ns: SettingsNamespace, value: Record<string, unknown>) {
    this.doc[ns] = structuredClone(value); return Promise.resolve()
  }
}

describe('Intranet dependency feedback', () => {
  it('guides concise mode-specific replies without a fixed dependency name or recovery suggestions', () => {
    for (const text of [INTRANET_DEPENDENCY_GUIDANCE, ...Object.values(DEPENDENCY_FEEDBACK)]) {
      expect(text).toContain('当前为纯内网模式')
      expect(text).toContain('任务暂时无法继续')
      expect(text).toContain('本次命令和失败日志')
      expect(text).toContain('无法确认')
      expect(text).toContain('不要输出处理建议')
      expect(text).not.toContain('humanize')
      expect(text).not.toContain('处理建议：')
    }
    expect(DEPENDENCY_FEEDBACK.unavailable).toContain('不能断定源已响应或网络不可达')
    expect(DEPENDENCY_FEEDBACK.download).toContain('⚠ 所需依赖下载失败')
  })

  it.each([
    ["ModuleNotFoundError: No module named 'humanize'", 'missing'],
    ['ERR_MODULE_NOT_FOUND: Cannot find package humanize', 'missing'],
    ['npm ERR! EAI_AGAIN registry.npmjs.org', 'download'],
    ['pip: Failed to establish a new connection: [WinError 10061] Connection refused', 'download'],
    ['pip download: SSLError CERTIFICATE_VERIFY_FAILED', 'download'],
    ['Looking in indexes: http://127.0.0.1:1/simple\nNo matching distribution found for humanize', 'unavailable'],
    ['pip: ConnectionError\nNo matching distribution found for humanize', 'download'],
    ['npm error code E404', 'unavailable'],
    ['ERR_PNPM_NO_MATCHING_VERSION', 'unavailable'],
    ['PackagesNotFoundError: humanize', 'unavailable'],
    ['SyntaxError: invalid syntax', undefined],
    ['pip: PermissionError: Permission denied', undefined],
    ['pip: Access is denied', undefined],
    ['Successfully installed humanize-4.15.0', undefined],
    ['HTTP request: ECONNREFUSED', undefined],
  ])('classifies actual diagnostics: %s', (text, kind) => {
    expect(dependencyFailure(text)).toBe(kind)
  })

  it.each(['bash', 'pwsh', 'terminal_send', 'terminal_read', 'job_output'])('allows downloads and adds failure feedback for %s', async (name) => {
    const ctx = new Context()
    try {
      await ctx.plugin(MemorySettings); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
      const execute = vi.fn(async () => 'Successfully installed humanize-4.15.0')
      ctx.tools.register(defineTool({ name, description: 'shell', parameters: {
        command: { type: 'string', required: true },
      }, output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] }, execute }))
      let policy!: ReturnType<typeof installNetworkPolicy>
      const fiber = await ctx.plugin({ name: 'test-network', inject: ['settings'], apply: (ctx: Context) => {
        policy = installNetworkPolicy(ctx, 'http://server.lan')
      } })
      const call = () => ctx.tools.execute({ name, callId: ToolCallId('install'),
        arguments: { command: 'python -m pip install humanize -i https://pypi.org/simple' },
        signal: new AbortController().signal })
      await policy.setMode('intranet')
      expect((await call()).content).toEqual([{ type: 'text', text: 'Successfully installed humanize-4.15.0' }])
      expect(execute).toHaveBeenCalledOnce()
      expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain(INTRANET_DEPENDENCY_GUIDANCE)
      for (const [text, kind] of [
        ["ModuleNotFoundError: No module named 'humanize'", 'missing'],
        ['pip: Connection refused', 'download'],
        ['No matching distribution found for humanize', 'unavailable'],
        ['No matching distribution found for openpyxl', 'unavailable'],
        ['npm error code E404: @example/unavailable-package', 'unavailable'],
      ] as const) {
        execute.mockResolvedValue(text)
        expect((await call()).content).toEqual([{ type: 'text', text }, { type: 'text', text: `\n${DEPENDENCY_FEEDBACK[kind]}` }])
      }
      execute.mockResolvedValue('pip: PermissionError: Permission denied')
      expect((await call()).content).toEqual([{ type: 'text', text: 'pip: PermissionError: Permission denied' }])
      execute.mockResolvedValue('pip: Connection refused')
      await policy.setMode('internet')
      expect((await call()).content).toEqual([{ type: 'text', text: 'pip: Connection refused' }])
      expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain(INTRANET_DEPENDENCY_GUIDANCE)
      await policy.setMode('intranet')
      await fiber.dispose()
      expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain(INTRANET_DEPENDENCY_GUIDANCE)
      expect((await call()).content).toEqual([{ type: 'text', text: 'pip: Connection refused' }])
    } finally { await ctx.fiber.dispose() }
  })
})
