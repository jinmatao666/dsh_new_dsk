import { afterEach, expect, it, vi } from 'vitest'
import { KnowledgeBaseApi } from '../src/knowledge-base.ts'

afterEach(() => vi.unstubAllGlobals())

it('forwards folder reads and creation through authenticated library routes', async () => {
  const service = new KnowledgeBaseApi('http://backend.test', async () => 'token', 60000, { transcriptionModel: 'asr', chatModel: 'chat' })
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token')
    return Response.json({ success: true, data: [] })
  })
  vi.stubGlobal('fetch', fetch)
  try {
    const signal = new AbortController().signal
    await service.call('folders', { id: 7 }, signal)
    await service.call('create-folder', { id: 7, name: '资料' }, signal)
    expect(fetch.mock.calls).toMatchObject([
      ['http://backend.test/api/knowledge-bases/7/folders', { headers: expect.any(Headers) }],
      ['http://backend.test/api/knowledge-bases/7/folders', { method: 'POST', body: JSON.stringify({ name: '资料' }) }],
    ])
    await expect(service.call('create-folder', { id: 7, name: '' }, signal)).rejects.toThrow()
    await expect(service.call('folders', { id: 'bad' }, signal)).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(2)
  } finally { await service.dispose() }
})
