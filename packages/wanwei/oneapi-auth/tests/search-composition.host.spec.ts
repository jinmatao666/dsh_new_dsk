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
import { installSearchCitationPolicy, OneApiSearchProvider } from '../src/search-provider.ts'

afterEach(() => vi.unstubAllGlobals())

it('passes real sources into model output and the replayable clickable search view', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(Response.json({ data: { search_model: 'qwen-plus' } }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '官方发布了公告。' } }],
      search_info: { search_results: [{ index: 1, title: '官方公告', url: 'https://news.example.com/release', snippet: '检索返回的公告摘要', publishedAt: '2026-10-29' }] } })))
  const root = await mkdtemp(join(tmpdir(), 'wanwei-search-sources-'))
  const ctx = new Context()
  let managed: Context | undefined
  try {
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, '- name: prompt\n- name: tools\n- name: web\n- name: managed-search\n- name: web-tool\n  config:\n    fetch: false\n')
    ctx.baseUrl = `${pathToFileURL(root).href}/`
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['prompt', SystemPrompt], ['tools', ToolRuntime], ['web', WebRuntime], ['web-tool', ToolWeb],
      ['managed-search', { name: 'managed-search', inject: ['web'], apply(ctx: Context) {
        managed = ctx
        installSearchCitationPolicy(ctx)
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
    const policy = (await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'wanwei:web-source-citations')
    expect(policy?.text).toContain('[网页真实标题](原文URL)')
    expect(policy?.text).toContain('正文。 来源：[网页真实标题](原文URL)')
    expect(policy?.text).toContain('不要将链接直接紧贴正文')
    expect(policy?.text).toContain('正文不支持结论')
    expect(policy?.text).toContain('连续两轮补搜')
    expect(policy?.text).not.toContain('至少检索并核对三个')
    expect(policy?.text).toMatchSnapshot()
    const result = await ctx.tools.execute({ name: 'web_search', callId: ToolCallId('search'),
      arguments: { queries: ['今日公告'] }, signal: new AbortController().signal })
    expect(result.isError).not.toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('官方发布了公告'))).toBe(false)
    expect(result.content.some(block => block.type === 'text'
      && block.text.includes('[官方公告](https://news.example.com/release)'))).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('检索返回的公告摘要'))).toBe(true)
    // JSON round-trip matches persisted tool/result metadata consumed on replay.
    const view = presentSearchResult({ queries: ['今日公告'] }, JSON.parse(JSON.stringify(result)) as typeof result)
    expect(view).toMatchInlineSnapshot(`
      {
        "answer": "来源分布：1 个链接，1 个网站（按域名统计，不代表独立发布机构）。下一步先用 web_fetch 读取相关具体原文，核对事件和发布日期；摘要仅供筛选，不是正文核验。再针对缺项补搜，避免重复搜索已有结果。",
        "card": "web",
        "kind": "search",
        "sources": [
          {
            "publishedAt": "2026-10-29",
            "snippet": "检索返回的公告摘要",
            "title": "官方公告",
            "url": "https://news.example.com/release",
          },
        ],
        "title": "今日公告",
        "truncated": false,
      }
    `)
    await managed!.fiber.dispose()
    expect((await ctx.systemPrompt.assemble()).sections.some(section => section.name === 'wanwei:web-source-citations')).toBe(false)
    const tools = ctx.tools
    await ctx.fiber.dispose()
    expect(tools.get('web_search')).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
