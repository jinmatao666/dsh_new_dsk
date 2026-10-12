import { afterEach, describe, expect, it, vi } from 'vitest'
import { OneApiSearchProvider } from '../src/search-provider.ts'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('Wanwei OneAPI web search', () => {
  it('uses the administrator-selected model and the authenticated token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { search_model: 'qwen3.6-plus' } }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'current answer' } }] }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new OneApiSearchProvider({ baseURL: 'https://oneapi.test/', resolveToken: async () => 'user-token' })
    const result = await provider.search({ query: 'latest news' })
    expect(result.sources).toEqual([])
    expect(result.content).toContain('本次搜索未返回可核验的来源链接')
    expect(result.content).toContain('不要编造来源网址')
    expect(fetchMock.mock.calls[0]).toEqual(['https://oneapi.test/api/status', { redirect: 'error' }])
    const [endpoint, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(endpoint).toBe('https://oneapi.test/v1/chat/completions')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(init.headers).toEqual({ authorization: 'Bearer user-token', 'content-type': 'application/json', 'x-dsh-web-search': '1' })
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'qwen3.6-plus', stream: false,
      messages: [{ role: 'user', content: '搜索网页并整理以下问题：latest news。只依据检索到的资料作答，区分事件日期与发布日期。' }],
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
    expect(result.content).toContain('在每条相关事实或结论旁引用')
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
