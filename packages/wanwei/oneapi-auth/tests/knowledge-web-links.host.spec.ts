import { afterEach, expect, it, vi } from 'vitest'
import { KnowledgeBaseApi } from '../src/knowledge-base.ts'

const active: KnowledgeBaseApi[] = []
afterEach(async () => {
  await Promise.all(active.splice(0).map(api => api.dispose()))
  vi.unstubAllGlobals()
})

it('posts trimmed web links to the knowledge-base web-links route', async () => {
  const service = new KnowledgeBaseApi('http://backend.test', async () => 'token', 60000, { transcriptionModel: 'asr', chatModel: 'chat' })
  active.push(service)
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe('http://backend.test/api/knowledge-bases/7/web-links')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      urls: ['https://www.cnblogs.com/wangboyu/p/14463680.html'],
    })
    return Response.json({ success: true, data: [{ id: 'doc-web-1' }] })
  }))
  await expect(service.call('import-web-links', {
    id: 7,
    urls: [' https://www.cnblogs.com/wangboyu/p/14463680.html '],
  }, new AbortController().signal)).resolves.toEqual([{ id: 'doc-web-1' }])
})

it('rejects empty or oversized web-link batches before calling the backend', async () => {
  const service = new KnowledgeBaseApi('http://backend.test', async () => 'token', 60000, { transcriptionModel: 'asr', chatModel: 'chat' })
  active.push(service)
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const call = (payload: unknown) => service.call('import-web-links', payload, new AbortController().signal)
  await expect(call({ id: 1, urls: [] })).rejects.toThrow('网页链接无效')
  await expect(call({
    id: 1,
    urls: Array.from({ length: 11 }, (_, index) => `https://example.com/${index}`),
  })).rejects.toThrow('网页链接无效')
  expect(fetch).not.toHaveBeenCalled()
})
