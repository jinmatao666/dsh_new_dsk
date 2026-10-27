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
import { installNetworkPolicy } from '../../oneapi-auth/src/network.ts'

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
  const desktopPatch = await readFile(new URL('../../../bundle/wanwei-desktop/cordis.patch.yml', import.meta.url), 'utf8')
  const shippedHeadless = desktopPatch.match(/headless: (true|false)/)?.[1]
  expect(shippedHeadless).toBe('true')
  root = await mkdtemp(join(tmpdir(), 'wanwei-browser-composition-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- name: test-prompt', '- name: test-tools', '- name: test-agents',
    '- name: test-settings', '  config:', `    path: ${JSON.stringify(join(root, 'settings.yaml'))}`, '    watch: false',
    "- name: '@deepseek-ai/dsh-wanwei-browser-use'", '  config:',
    `    headless: ${process.env.DSH_BROWSER_TEST_HEADED === '1' ? 'false' : shippedHeadless}`,
    ...process.env.DSH_BROWSER_TEST_EXECUTABLE === undefined ? [] : [`    executablePath: ${JSON.stringify(chromium)}`], '',
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
  const policy = installNetworkPolicy(ctx, 'http://server.lan')
  const id = SessionId('browser-loader')
  const agent = { id, session: Session.create(id, [], { version: 0, id, createdAt: 0, cwd: root }) } as Agent
  const scope = createScope(ctx, agent)
  Object.assign(agent, { ctx: scope.ctx })
  const unregister = ctx.agents.register(agent)
  const pending = await ctx.systemPrompt.assemble(assembleContextFor(agent))
  expect(pending.tools.some(tool => tool.name.startsWith('mcp__playwright-mcp__'))).toBe(false)
  policy.setPlugins({ browserAssistant: true })
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
  expect(assembly.tools.map(tool => tool.name)).toContain('mcp__playwright-mcp__browser_navigate')
  policy.setPlugins({ browserAssistant: false })
  expect(ctx.tools.schemas(assembleContextFor(agent)).some(tool => tool.name.startsWith('mcp__playwright-mcp__'))).toBe(false)
  const administratorDenied = await ctx.tools.execute({ name: 'mcp__playwright-mcp__browser_navigate',
    arguments: { url: 'about:blank' }, callId: ToolCallId('browser-administrator-disabled'), agent,
    signal: new AbortController().signal })
  expect(administratorDenied.isError).toBe(true)
  expect(JSON.stringify(administratorDenied.content)).toContain('管理员未允许使用浏览器助手')
  expect(administratorDenied.content).toMatchInlineSnapshot(`
    [
      {
        "text": "Error: 管理员未允许使用浏览器助手，请联系管理员或刷新后台配置",
        "type": "text",
      },
    ]
  `)
  expect(ctx.settings.get(settingsNamespace('wanwei-browser-use'))).toMatchObject({ enabled: true })
  await ctx.settings.update(settingsNamespace('wanwei-browser-use'), { enabled: false })
  policy.setPlugins({ browserAssistant: true })
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
  const form = '<html><body><label>测试输入<input id="name"></label><button onclick="document.getElementById(\'out\').textContent=document.getElementById(\'name\').value">确认</button><p id="out"></p></body></html>'
  const navigate = await ctx.tools.execute({ name: 'mcp__playwright-mcp__browser_navigate',
    arguments: { url: `data:text/html;charset=utf-8,${encodeURIComponent(form)}` },
    callId: ToolCallId('browser-form'), agent, signal: new AbortController().signal })
  expect(navigate.isError).toBe(false)
  const navigateText = navigate.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
  const formLink = navigateText.match(/\[Snapshot\]\(([^)]+)\)/)
  const formSnapshot = formLink === null ? navigateText : await readFile(resolve(root, formLink[1]!), 'utf8')
  const inputRef = formSnapshot.match(/textbox[^\n]*\[ref=([^\]]+)\]/)?.[1]
  const buttonRef = formSnapshot.match(/button[^\n]*\[ref=([^\]]+)\]/)?.[1]
  expect(inputRef).toBeDefined(); expect(buttonRef).toBeDefined()
  const fill = await ctx.tools.execute({ name: 'mcp__playwright-mcp__browser_fill_form',
    arguments: { fields: [{ name: '测试输入', type: 'textbox', target: inputRef, value: '浏览器操作正常' }] },
    callId: ToolCallId('browser-fill'), agent, signal: new AbortController().signal })
  expect(fill.isError, JSON.stringify(fill.content)).toBe(false)
  const click = await ctx.tools.execute({ name: 'mcp__playwright-mcp__browser_click',
    arguments: { target: buttonRef },
    callId: ToolCallId('browser-click'), agent, signal: new AbortController().signal })
  expect(click.isError, JSON.stringify(click.content)).toBe(false)
  const clickText = click.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
  const clickLink = clickText.match(/\[Snapshot\]\(([^)]+)\)/)
  const clickSnapshot = clickLink === null ? clickText : await readFile(resolve(root, clickLink[1]!), 'utf8')
  expect(clickSnapshot).toMatch(/paragraph[^\n]*浏览器操作正常/)
  await scope.dispose()
  unregister()
  expect(ctx.tools.schemas().some(tool => tool.name.startsWith('mcp__playwright-mcp__'))).toBe(false)
}, 30000)
