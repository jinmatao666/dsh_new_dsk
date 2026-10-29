import { afterEach, describe, expect, it, vi } from 'vitest'
import { OneApiSearchProvider } from '../src/search-provider.ts'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('Wanwei OneAPI web search', () => {
  it('distinguishes different article links from different source websites', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { search_model: 'qwen-plus' } }))
      .mockResolvedValueOnce(jsonResponse({ search_info: { search_results: [
        { url: 'https://news.example.com/first' }, { url: 'https://www.news.example.com/second' },
      ] } })))
    const result = await new OneApiSearchProvider({ baseURL: 'https://oneapi.test', resolveToken: async () => 'token' })
      .search({ query: '今天的人工智能新闻' })
    expect(result.sources).toHaveLength(2)
    expect(result.content).toContain('2 个链接，1 个网站')
    expect(result.content).toContain('所有链接都来自同一个网站')
    expect(result.content).toContain('继续调用 web_search 检索其他网站')
    expect(result.content).toContain('至少检索并核对三个不同发布网站')
    expect(result.content).toContain('转载或镜像不算独立来源')
    expect(result.content).toContain('用户明确限定某个网站')
  })
  it('explains endpoint rejection without exposing the raw upstream response or credentials', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { search_model: 'qwen3.6-plus' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: {
        code: 'InvalidParameter', message: 'url error, please check url; Bearer secret-key',
      } }), { status: 400 })))
    const provider = new OneApiSearchProvider({ baseURL: 'https://oneapi.test', resolveToken: async () => 'token' })
    await expect(provider.search({ query: '新闻' })).rejects.toThrowErrorMatchingInlineSnapshot('[WebError: 网页搜索失败（HTTP 400，错误代码：InvalidParameter）。模型与搜索接口不匹配。请求被拒绝，请停止重复搜索并告知用户检查后台搜索模型与渠道配置；更换关键词不能解决接口错误。]')
  })

  it('explains the streaming requirement and keeps malformed error codes out of diagnostics', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { search_model: 'qwen3.6-plus' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: {
        code: 'Bearer secret', message: 'Non-streaming mode does not support Web Search',
      } }), { status: 400 })))
    const provider = new OneApiSearchProvider({ baseURL: 'https://oneapi.test', resolveToken: async () => 'token' })
    await expect(provider.search({ query: '新闻' })).rejects.toThrowErrorMatchingInlineSnapshot('[WebError: 网页搜索失败（HTTP 400）。搜索模型要求使用流式接口。请求被拒绝，请停止重复搜索并告知用户检查后台搜索模型与渠道配置；更换关键词不能解决接口错误。]')
  })
  it('uses the administrator-selected model and the authenticated token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { search_model: 'qwen3.6-plus' } }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'current answer' } }] }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new OneApiSearchProvider({ baseURL: 'https://oneapi.test/', resolveToken: async () => 'user-token' })
    const result = await provider.search({ query: 'latest news' })
    expect(result.sources).toEqual([])
    expect(result.content).toContain('本次搜索未返回可核验的来源链接')
    expect(result.content).toContain('不要编造标题或链接')
    expect(result.content).not.toContain('current answer')
    expect(fetchMock.mock.calls[0]).toEqual(['https://oneapi.test/api/status', { redirect: 'error' }])
    const [endpoint, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(endpoint).toBe('https://oneapi.test/v1/chat/completions')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(init.headers).toEqual({ authorization: 'Bearer user-token', 'content-type': 'application/json', 'x-dsh-web-search': '1' })
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'qwen3.6-plus', stream: false,
      messages: [{ role: 'user', content: '搜索网页并整理以下问题：latest news。尽量返回不同发布网站的独立原文页面，避免只返回一篇热点汇总。只依据检索到的资料作答，区分事件日期与发布日期。每条正文以句末标点结束，空格后添加“来源：”和真实网页标题的可点击链接，格式为 正文。 来源：[网页真实标题](原文URL)。链接必须指向支持对应信息的具体原文页面，不得编造标题、网址或用无关网页代替。' }],
    })
  })

  it('retains only structured HTTP sources, deduplicates URLs and requests inline citations', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { search_model: 'qwen-plus' } }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '网页答案 [1]' } }],
        search_info: { search_results: [
          { index: 1, title: ' 官方公告 ', url: 'https://news.example.com/release' },
          { index: 2, title: '重复', url: 'https://news.example.com/release' },
          { url: 'https://second.example.com/' },
          { url: 'javascript:alert(1)' }, { url: 'file:///secret' },
          { url: 'https://user:password@example.com/' }, { url: 'invalid' }, null,
        ] } })))
    const result = await new OneApiSearchProvider({ baseURL: 'https://oneapi.test', resolveToken: async () => 'token' })
      .search({ query: '新闻' })
    expect(result.sources).toEqual([
      { title: '官方公告', url: 'https://news.example.com/release' }, { url: 'https://second.example.com/' },
    ])
    expect(result.content).toContain('正文末尾先用句号、问号或叹号等句末标点结束')
    expect(result.content).toContain('正文。 来源：[网页真实标题](原文URL)')
    expect(result.content).toContain('正文。 来源：[原文URL](原文URL)')
    expect(result.content).toContain('多条信息逐条附上对应来源')
    expect(result.content).toContain('[网页真实标题](原文URL)')
    expect(result.content).toContain('返回的原始标题')
    expect(result.content).toContain('没有真实标题时显示可点击的原文 URL')
    expect(result.content).toContain('先用 web_fetch')
    expect(result.content).not.toContain('网页答案')
    expect(result.content).not.toContain('未返回可核验')
  })

  it('does not treat a model-written link as a verified search source', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { search_model: 'qwen-plus' } }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '[假来源](https://made-up.example.com)' } }] })))
    const result = await new OneApiSearchProvider({ baseURL: 'https://oneapi.test', resolveToken: async () => 'token' })
      .search({ query: '新闻' })
    expect(result.sources).toEqual([])
    expect(result.content).toContain('未返回可核验的来源链接')
    expect(result.content).not.toContain('made-up.example.com')
  })

  it('does not pass invented links or claims through alongside legitimate retrieval metadata', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { search_model: 'qwen-plus' } }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: {
        content: '虚构消息 [source](https://made-up.example.com/news) <a href="https://fake.example.com">来源</a>',
      } }], search_info: { search_results: [{ title: '公告', url: 'https://news.example.com/release' }] } })))
    const result = await new OneApiSearchProvider({ baseURL: 'https://oneapi.test', resolveToken: async () => 'token' })
      .search({ query: '新闻' })
    expect(result.sources).toEqual([{ title: '公告', url: 'https://news.example.com/release' }])
    expect(result.content).not.toContain('虚构消息')
    expect(result.content).not.toContain('made-up.example.com')
    expect(result.content).not.toContain('fake.example.com')
    expect(result.content).toContain('正文不支持结论')
    expect(result.content).toContain('明确标注未核实')
    expect(result.content).toContain('当前只有一个来源，不能据此列出多条独立新闻')
  })

  it('accepts structured retrieval metadata without a generated summary', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { search_model: 'qwen-plus' } }))
      .mockResolvedValueOnce(jsonResponse({ search_info: { search_results: [{ url: 'https://news.example.com/release' }] } })))
    const result = await new OneApiSearchProvider({ baseURL: 'https://oneapi.test', resolveToken: async () => 'token' })
      .search({ query: '新闻' })
    expect(result.sources).toHaveLength(1)
    expect(result.content).toContain('[网页真实标题]')
    expect(result.content).toContain('本次仅检索到 1 个不同的原文链接')
  })

  it('does not contact OneAPI before login or when no search model is configured', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { search_model: '' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(new OneApiSearchProvider({ baseURL: 'https://oneapi.test', resolveToken: async () => undefined })
      .search({ query: 'q' })).rejects.toThrow('Sign in')
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(new OneApiSearchProvider({ baseURL: 'https://oneapi.test', resolveToken: async () => 'token' })
      .search({ query: 'q' })).rejects.toThrow('not configured')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('refuses a redirect without contacting its target', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.redirect).toBe('error')
      throw new TypeError('redirect refused')
    })
    vi.stubGlobal('fetch', fetchMock)
    const provider = new OneApiSearchProvider({ baseURL: 'https://oneapi.test', resolveToken: async () => 'token' })
    await expect(provider.search({ query: 'q' })).rejects.toThrow('redirect refused')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://oneapi.test/api/status')
  })
})
