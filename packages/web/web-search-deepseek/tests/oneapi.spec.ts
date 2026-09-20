import { afterEach, describe, expect, it, vi } from 'vitest'
import { OneApiSearchProvider } from '../src/oneapi-provider.ts'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OneApiSearchProvider', () => {
  it('uses the public configured model and marks only the search completion', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { search_model: 'qwen3.6-plus' } }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'current answer' } }] }))
    const recordRequest = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const provider = new OneApiSearchProvider({
      baseURL: 'https://oneapi.test/',
      resolveToken: async () => 'user-token',
      recordRequest,
    })

    await expect(provider.search({ query: 'latest news' })).resolves.toEqual({
      content: 'current answer',
      sources: [],
      truncated: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]).toEqual([
      'https://oneapi.test/api/status',
      { redirect: 'error' },
    ])
    const [endpoint, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(endpoint).toBe('https://oneapi.test/v1/chat/completions')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(init.headers).toEqual({
      authorization: 'Bearer user-token',
      'content-type': 'application/json',
      'x-dsh-web-search': '1',
    })
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'qwen3.6-plus',
      stream: false,
      messages: [{ role: 'user', content: 'Search the web and summarize this query: latest news' }],
    })
    expect(recordRequest).toHaveBeenCalledWith({
      endpoint,
      model: 'qwen3.6-plus',
      query: 'latest news',
    })
  })

  it('fails before completion when no search model is configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: { search_model: '' } })))
    const provider = new OneApiSearchProvider({
      baseURL: 'https://oneapi.test',
      resolveToken: async () => 'user-token',
    })

    await expect(provider.search({ query: 'q' })).rejects.toThrow('not configured')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('does not contact the server without a desktop token', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const provider = new OneApiSearchProvider({
      baseURL: 'https://oneapi.test',
      resolveToken: async () => undefined,
    })

    await expect(provider.search({ query: 'q' })).rejects.toThrow('Sign in')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
