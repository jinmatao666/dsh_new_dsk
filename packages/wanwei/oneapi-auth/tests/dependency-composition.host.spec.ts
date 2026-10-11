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
  const execute = vi.fn(async () => 'Successfully downloaded humanize')
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
        ctx.effect(() => ctx.tools.register(defineTool({ name: 'pwsh', description: 'fake shell',
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
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('下载成功就继续任务')
    const success = await ctx.tools.execute({ name: 'pwsh', callId: ToolCallId('success'),
      arguments: { command: 'pip install https://pypi.org/packages/x.whl' }, signal: new AbortController().signal })
    expect(success.isError).toBe(false)
    expect(execute).toHaveBeenCalledOnce()
    expect(success.content).toEqual([{ type: 'text', text: 'Successfully downloaded humanize' }])
    execute.mockResolvedValue('pip: Failed to establish a new connection: Connection refused')
    const result = await ctx.tools.execute({ name: 'pwsh', callId: ToolCallId('failure'),
      arguments: { command: 'python -m pip download humanize -i http://127.0.0.1:1/simple' },
      signal: new AbortController().signal })
    expect(result.content).toMatchInlineSnapshot(`
      [
        {
          "text": "pip: Failed to establish a new connection: Connection refused",
          "type": "text",
        },
        {
          "text": "
      当前为纯内网模式，工具报告依赖下载连接失败。请依据原始输出说明实际原因，不要仅因内网模式断言整台电脑断网。若必需依赖无法获取，停止依赖它的步骤，在对话中简短输出“⚠ 所需依赖下载失败”、依赖名称与任务暂时无法继续、失败原因、处理建议：请联系管理员提供可用的内网依赖源或离线安装包。不要盲目重试、擅自换源或声称任务成功，不把临时脚本作为正式产物。",
          "type": "text",
        },
      ]
    `)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
