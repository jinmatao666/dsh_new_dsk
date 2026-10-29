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
    expect(result.content).toContain('下一步先用 web_fetch')
    expect(result.content).not.toContain('至少检索并核对三个不同发布网站')
    expect(result.content).not.toContain('请继续调用 web_search')
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
      messages: [
        { role: 'system', content: '执行联网检索，保留用户查询中的日期、语言和站点条件。返回相关的具体原文页面，优先原始发布者。不要用站点首页替代文章，不编造来源。' },
        { role: 'user', content: 'latest news' },
      ],
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
    expect(result.content).toContain('先用 web_fetch')
    expect(result.content).toContain('摘要仅供筛选')
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
    expect(result.content).toContain('核对事件和发布日期')
    expect(result.content).toContain('不是正文核验')
    expect(result.content).toContain('1 个链接，1 个网站')
  })

  it('accepts structured retrieval metadata without a generated summary', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { search_model: 'qwen-plus' } }))
      .mockResolvedValueOnce(jsonResponse({ search_info: { search_results: [{ url: 'https://news.example.com/release' }] } })))
    const result = await new OneApiSearchProvider({ baseURL: 'https://oneapi.test', resolveToken: async () => 'token' })
      .search({ query: '新闻' })
    expect(result.sources).toHaveLength(1)
    expect(result.content).toContain('先用 web_fetch')
    expect(result.content).toContain('1 个链接')
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

it('preserves retrieval snippets and supplied ISO dates without adopting generated prose', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ data:{ search_model:'qwen-plus' } }))
    .mockResolvedValueOnce(jsonResponse({ choices:[{ message:{ content:'unsupported generated claim' } }],search_info:{ search_results:[
      { url:'https://example.com/a',snippet:'Actual search excerpt',published_at:'2026-10-29' },
      { url:'https://example.com/b',snippet:12,publishedAt:'today' },
    ] } })))
  const result = await new OneApiSearchProvider({ baseURL:'https://oneapi.test',resolveToken:async ()=>'token' }).search({ query:'today AI' })
  expect(result.sources).toEqual([{ url:'https://example.com/a',snippet:'Actual search excerpt',publishedAt:'2026-10-29' },
    { url:'https://example.com/b' }])
  expect(result.content).not.toContain('unsupported generated claim')
})
it('does not pass off unrelated domains as successful site-restricted results', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse({ data:{ search_model:'qwen-plus' } }))
    .mockResolvedValueOnce(jsonResponse({ search_info:{ search_results:[{ url:'https://sina.com/news' }] } }))
  vi.stubGlobal('fetch',fetcher)
  const provider = new OneApiSearchProvider({ baseURL:'https://oneapi.test',resolveToken:async ()=>'token' })
  await expect(provider.search({ query:'AI news site:reuters.com' })).rejects.toMatchObject({ code:'WEB_PROVIDER_SCOPE_MISMATCH' })
  const body = JSON.parse((fetcher.mock.calls[1] as [string, RequestInit])[1].body as string) as { messages: { content: string }[] }
  expect(body.messages.at(-1)?.content)
    .toBe('AI news site:reuters.com')
})
it('retains matching domains and subdomains while filtering suffix lookalikes', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ data:{ search_model:'qwen-plus' } }))
    .mockResolvedValueOnce(jsonResponse({ search_info:{ search_results:[
      { url:'https://reuters.com/a' },{ url:'https://www.reuters.com/b' },{ url:'https://notreuters.com/c' },
    ] } })))
  const result = await new OneApiSearchProvider({ baseURL:'https://oneapi.test',resolveToken:async ()=>'token' })
    .search({ query:'AI site:reuters.com' })
  expect(result.sources.map(source => source.url)).toEqual(['https://reuters.com/a','https://www.reuters.com/b'])
})
