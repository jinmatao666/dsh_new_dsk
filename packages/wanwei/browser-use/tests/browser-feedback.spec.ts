import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'
import * as BrowserPlugin from '../src/index.ts'
import { BROWSER_GUIDANCE, BROWSER_UNAVAILABLE, resolveBrowserExecutable } from '../src/browser-executable.ts'

// Startup failures are deterministic here; the Loader test exercises the real MCP/browser.
vi.mock('@deepseek-ai/dsh-experimental-browser-use-playwright-mcp', () => ({ apply: vi.fn() }))
vi.mock('../src/browser-executable.ts', async original => ({
  ...await original<typeof import('../src/browser-executable.ts')>(), resolveBrowserExecutable: vi.fn(),
}))
let ctx: Context
afterEach(async () => { await ctx?.fiber.dispose() })

async function setup(path?: string) {
  ctx = new Context()
  await ctx.plugin(MemorySettings); await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry)
  vi.mocked(resolveBrowserExecutable).mockResolvedValue(path)
  const fiber = await ctx.plugin(BrowserPlugin, { enabled: true, headless: false })
  const execute = vi.fn(async () => 'Error: Browser "chrome-for-testing" is not installed')
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'mcp__playwright-mcp__browser_navigate', description: 'startup failure', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute,
  })))
  const call = () => ctx.tools.execute({ name: 'mcp__playwright-mcp__browser_navigate', arguments: {},
    callId: ToolCallId('browser-startup'), signal: new AbortController().signal })
  return { fiber, execute, call }
}

it('denies missing-browser execution with Chinese feedback and never invokes the provider', async () => {
  const { execute, call } = await setup()
  const result = await call()
  expect(result.isError).toBe(true)
  expect(result.content).toEqual([{ type: 'text', text: `Error: ${BROWSER_UNAVAILABLE}` }])
  expect(execute).not.toHaveBeenCalled()
})

it('returns startup failure guidance in the tool result and removes policy on disposal', async () => {
  const { fiber, call } = await setup('browser.exe')
  const result = await call()
  expect(result.isError).toBe(true)
  expect(result.content).toMatchInlineSnapshot(`
    [
      {
        "text": "浏览器启动失败，当前浏览器任务无法继续。请检查浏览器安装和可执行文件路径，处理后重启桌面端并新建对话。不要自动下载浏览器或用脚本绕过，请如实向用户说明失败原因。",
        "type": "text",
      },
      {
        "text": "Error: Browser \"chrome-for-testing\" is not installed",
        "type": "text",
      },
    ]
  `)
  expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain(BROWSER_GUIDANCE)
  await fiber.dispose()
  expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain(BROWSER_GUIDANCE)
  expect((await call()).isError).toBe(false)
})
