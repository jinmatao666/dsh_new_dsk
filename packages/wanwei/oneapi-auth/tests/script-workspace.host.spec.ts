import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { expect, it } from 'vitest'
import { installScriptWorkspaceGuidance } from '../src/script-workspace.ts'

it('places helper scripts under the owning workspace session and removes guidance on disposal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wanwei-script-workspace-'))
  const ctx = new Context()
  let managed: Context | undefined
  try {
    await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry); await ctx.plugin(AgentLoop, { agents: [] })
    const config = join(root, 'cordis.yml')
    await writeFile(config, '- name: script-workspace\n')
    ctx.baseUrl = `${pathToFileURL(root).href}/`
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = { version: 'v2', async import() {
      return { apply(child: Context) { managed = child; installScriptWorkspaceGuidance(child) } }
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
    await ctx.loader.await()
    const { agent } = await ctx.agents.create({ sessionId: SessionId('work-a'), meta: { cwd: root } })
    const section = (await ctx.systemPrompt.assemble({ scope: agent })).sections.find(item => item.name === 'wanwei:script-workspace')
    expect(section?.text).toContain(JSON.stringify(join(root, '.dsh-work', 'work-a', 'scripts')))
    expect(section?.text).toContain('最终交付文件默认放在工作区根目录')
    expect((await ctx.systemPrompt.assemble()).sections.some(item => item.name === 'wanwei:script-workspace')).toBe(false)
    await managed!.fiber.dispose()
    expect((await ctx.systemPrompt.assemble({ scope: agent })).sections.some(item => item.name === 'wanwei:script-workspace')).toBe(false)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
