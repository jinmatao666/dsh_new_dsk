/** Loader-composed policy smoke with a fake shell, without executing downloads. */
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SettingsFile from '@deepseek-ai/dsh-settings-file'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { installNetworkPolicy } from '../src/network.ts'

it('boots the intranet policy from cordis.yml and exposes feedback in prompt and tool output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wanwei-intranet-dependency-'))
  const ctx = new Context()
  const execute = vi.fn(async () => "ModuleNotFoundError: No module named 'pandas'")
  try {
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- name: test-settings', '  config:', `    path: ${JSON.stringify(join(root, 'settings.yaml'))}`, '    watch: false',
      '- name: test-prompt', '- name: test-tools', '- name: test-network', '- name: test-shell', '',
    ].join('\n'))
    ctx.baseUrl = `${pathToFileURL(root).href}/`
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['test-settings', SettingsFile], ['test-prompt', SystemPrompt], ['test-tools', ToolRuntime],
      ['test-network', { name: 'test-network', inject: ['settings'], apply(ctx: Context) {
        installNetworkPolicy(ctx, 'http://server.lan')
      } }],
      ['test-shell', { name: 'test-shell', inject: ['tools'], apply(ctx: Context) {
        ctx.effect(() => ctx.tools.register(defineTool({ name: 'bash', description: 'fake shell',
          parameters: { command: { type: 'string', required: true } },
          output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] }, execute })))
      } }],
    ])
    ctx.loader.internal = { version: 'v2', async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`Unexpected plugin: ${specifier}`)
      return modules.get(specifier)
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    await ctx.settings.update(settingsNamespace('wanwei-network'), { mode: 'intranet' })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('只有必需依赖无法获取且没有替代方案时')
    const denied = await ctx.tools.execute({ name: 'bash', callId: ToolCallId('blocked'),
      arguments: { command: 'pip install https://pypi.org/packages/x.whl' }, signal: new AbortController().signal })
    expect(denied.isError).toBe(true)
    expect(execute).not.toHaveBeenCalled()
    expect(denied.content).toMatchInlineSnapshot(`
      [
        {
          "text": "Error: 当前为纯内网环境，无法在线下载所需依赖。请先检查依赖是否已安装，或使用离线安装包、内网依赖源；若必需依赖仍无法获取，任务暂时无法继续，请联系管理员安装依赖。不要反复尝试外网下载，也不要将未完成的任务描述为成功。",
          "type": "text",
        },
      ]
    `)
    const result = await ctx.tools.execute({ name: 'bash', callId: ToolCallId('missing'),
      arguments: { command: 'python script.py' }, signal: new AbortController().signal })
    expect(JSON.stringify(result.content)).toContain("No module named 'pandas'")
    expect(JSON.stringify(result.content)).toContain('任务暂时无法继续')
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
