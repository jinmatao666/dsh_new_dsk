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
      search_info: { search_results: [{ index: 1, title: '官方公告', url: 'https://news.example.com/release' }] } })))
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
    expect(policy?.text).toMatchSnapshot()
    const result = await ctx.tools.execute({ name: 'web_search', callId: ToolCallId('search'),
      arguments: { queries: ['今日公告'] }, signal: new AbortController().signal })
    expect(result.isError).not.toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('官方发布了公告'))).toBe(false)
    expect(result.content.some(block => block.type === 'text'
      && block.text.includes('[官方公告](https://news.example.com/release)'))).toBe(true)
    // JSON round-trip matches persisted tool/result metadata consumed on replay.
    const view = presentSearchResult({ queries: ['今日公告'] }, JSON.parse(JSON.stringify(result)) as typeof result)
    expect(view).toMatchInlineSnapshot(`
      {
        "answer": "来源分布：1 个链接，1 个网站（按域名统计，不代表独立发布机构）。所有链接都来自同一个网站，尚不满足综合新闻的多来源要求；请继续调用 web_search 检索其他网站。本次仅检索到 1 个不同的原文链接。当前只有一个来源，不能据此列出多条独立新闻；如需更多条目，请继续检索不同网站的原文。网页搜索返回的是候选网页，不代表已核实正文。回答前先用 web_fetch 或可用的浏览器工具读取具体原文，逐条核对事实、事件日期和发布日期。在每条相关事实或结论的正文末尾先用句号、问号或叹号等句末标点结束，再留一个空格并添加“来源：”及可点击的原文链接，格式为 正文。 来源：[网页真实标题](原文URL)。不要将链接直接紧贴正文，也不要用 source、源网站或只有编号的引用代替“来源：”。链接文字使用检索或实际页面返回的原始标题，不得编造标题。没有真实标题时显示可点击的原文 URL，格式为 正文。 来源：[原文URL](原文URL)，不猜测标题。多条信息逐条附上对应来源；同一条有多个来源时用顿号分隔链接。链接只能来自本次或后续检索、网页读取工具实际返回的 URL；不能猜测或拼接网址，不能用站点首页或无关网页支撑具体消息。读取失败、正文不支持结论或资料不足时，明确标注未核实或不采用该条，不得声称已验证。没有来源时明确说明未找到可核验的原文网页。用户要求多条新闻时，每条新闻必须有支持该事件的独立原文页面和不同的原文 URL；优先检索不同发布网站。热点汇总页或同一篇文章只能算一个来源，不能拆成多条新闻反复引用。来源不足时继续用不同关键词检索并核对原文；仍不足就只报告已核实的条目和数量，不补齐、不编造。综合新闻或热点汇总的来源必须分散到不同发布网站；汇总三条及以上新闻时，至少检索并核对三个不同发布网站的相关原文。更换同站文章链接、同一稿件的转载或镜像不算独立来源。单站结果只能作为检索线索，必须根据具体事件继续调用 web_search 查找其他网站的原文；最终仍不足时明确写出来源网站数量和覆盖局限，不能声称是全面新闻汇总。用户明确限定某个网站或要求总结某篇文章时，按其范围处理。",
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
