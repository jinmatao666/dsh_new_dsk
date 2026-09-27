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
    await expect(provider.search({ query: 'latest news' })).resolves.toEqual({ content: 'current answer', sources: [], truncated: false })
    expect(fetchMock.mock.calls[0]).toEqual(['https://oneapi.test/api/status', { redirect: 'error' }])
    const [endpoint, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(endpoint).toBe('https://oneapi.test/v1/chat/completions')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(init.headers).toEqual({ authorization: 'Bearer user-token', 'content-type': 'application/json', 'x-dsh-web-search': '1' })
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'qwen3.6-plus', stream: false,
      messages: [{ role: 'user', content: 'Search the web and summarize this query: latest news' }],
    })
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
