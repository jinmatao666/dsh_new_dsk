/** Exercises source propagation through the Loader and the real web tool presenter. */
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as ToolWeb from '../../../web/tool-web/src/index.ts'
import { presentSearchResult } from '../../../web/tool-web/src/search.ts'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { OneApiSearchProvider } from '../src/search-provider.ts'

afterEach(() => vi.unstubAllGlobals())

it('passes real sources into model output and the replayable clickable search view', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(Response.json({ data: { search_model: 'qwen-plus' } }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '官方发布了公告。' } }],
      search_info: { search_results: [{ index: 1, title: '官方公告', url: 'https://news.example.com/release' }] } })))
  const root = await mkdtemp(join(tmpdir(), 'wanwei-search-sources-'))
  const ctx = new Context()
  try {
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, '- name: prompt\n- name: tools\n- name: web\n- name: managed-search\n- name: web-tool\n  config:\n    fetch: false\n')
    ctx.baseUrl = `${pathToFileURL(root).href}/`
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['prompt', SystemPrompt], ['tools', ToolRuntime], ['web', WebRuntime], ['web-tool', ToolWeb],
      ['managed-search', { name: 'managed-search', inject: ['web'], apply(ctx: Context) {
        ctx.effect(() => ctx.web.registerSearchProvider(new OneApiSearchProvider({
          baseURL: 'https://oneapi.test', resolveToken: async () => 'token',
        })))
      } }],
    ])
    ctx.loader.internal = { version: 'v2', async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`Unexpected plugin: ${specifier}`)
      return modules.get(specifier)
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    const result = await ctx.tools.execute({ name: 'web_search', callId: ToolCallId('search'),
      arguments: { queries: ['今日公告'] }, signal: new AbortController().signal })
    expect(result.isError).not.toBe(true)
    expect(result.content.some(block => block.type === 'text'
      && block.text.includes('[官方公告](https://news.example.com/release)'))).toBe(true)
    // JSON round-trip matches persisted tool/result metadata consumed on replay.
    const view = presentSearchResult({ queries: ['今日公告'] }, JSON.parse(JSON.stringify(result)) as typeof result)
    expect(view).toMatchInlineSnapshot(`
      {
        "answer": "官方发布了公告。

      回答时在每条相关事实或结论旁引用下方 Sources 中对应的真实网址，使用 Markdown 链接。不要编造网址或把无来源支持的内容当成已核实事实；不要仅使用 [1] 等没有链接的编号。",
        "card": "web",
        "kind": "search",
        "sources": [
          {
            "title": "官方公告",
            "url": "https://news.example.com/release",
          },
        ],
        "title": "今日公告",
        "truncated": false,
      }
    `)
    const tools = ctx.tools
    await ctx.fiber.dispose()
    expect(tools.get('web_search')).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
