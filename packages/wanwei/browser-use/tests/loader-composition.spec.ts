import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as BrowserPlugin from '../src/index.ts'
import SettingsFile from '@deepseek-ai/dsh-settings-file'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

let ctx: Context | undefined
let root: string | undefined
afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const chromium = process.env.DSH_BROWSER_TEST_EXECUTABLE
  ?? (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '')

it.skipIf(!existsSync(chromium))('boots the official provider through Loader, navigates and unloads', async () => {
  root = await mkdtemp(join(tmpdir(), 'wanwei-browser-composition-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- name: test-prompt', '- name: test-tools', '- name: test-agents',
    '- name: test-settings', '  config:', `    path: ${JSON.stringify(join(root, 'settings.yaml'))}`, '    watch: false',
    "- name: '@deepseek-ai/dsh-wanwei-browser-use'", '  config:',
    '    enabled: true', '    headless: true', `    executablePath: ${JSON.stringify(chromium)}`, '',
  ].join('\n'))
  ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-prompt', SystemPrompt], ['test-tools', ToolRuntime], ['test-agents', AgentRegistry],
    ['test-settings', SettingsFile],
    ['@deepseek-ai/dsh-wanwei-browser-use', BrowserPlugin],
  ])
  ctx.loader.internal = {
    version: 'v2', async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`Unexpected plugin ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const id = SessionId('browser-loader')
  const agent = { id, session: Session.create(id, [], { version: 0, id, createdAt: 0, cwd: root }) } as Agent
  const scope = createScope(ctx, agent)
  Object.assign(agent, { ctx: scope.ctx })
  const unregister = ctx.agents.register(agent)
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
  expect(assembly.tools.map(tool => tool.name)).toContain('mcp__playwright-mcp__browser_navigate')
  await ctx.settings.update(settingsNamespace('wanwei-browser-use'), { enabled: false })
  expect(ctx.tools.schemas(assembleContextFor(agent)).some(tool => tool.name.startsWith('mcp__playwright-mcp__'))).toBe(false)
  const denied = await ctx.tools.execute({ name: 'mcp__playwright-mcp__browser_navigate',
    arguments: { url: 'about:blank' }, callId: ToolCallId('browser-disabled'), agent,
    signal: new AbortController().signal })
  expect(denied.isError).toBe(true)
  expect(JSON.stringify(denied.content)).toContain('浏览器助手已停用')
  await ctx.settings.update(settingsNamespace('wanwei-browser-use'), { enabled: true })
  expect(await readFile(join(root, 'settings.yaml'), 'utf8')).toContain('enabled: true')
  const result = await ctx.tools.execute({
    name: 'mcp__playwright-mcp__browser_navigate',
    arguments: { url: 'about:blank' }, callId: ToolCallId('browser-loader-navigate'), agent,
    signal: new AbortController().signal,
  })
  expect(result.isError).toBe(false)
  const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
  const snapshot = text.match(/\[Snapshot\]\(([^)]+)\)/)
  const visible = snapshot === null ? text : `${text}\n${await readFile(resolve(root, snapshot[1]!), 'utf8')}`
  expect(visible).toContain('about:blank')
  await scope.dispose()
  unregister()
  expect(ctx.tools.schemas().some(tool => tool.name.startsWith('mcp__playwright-mcp__'))).toBe(false)
}, 30000)
