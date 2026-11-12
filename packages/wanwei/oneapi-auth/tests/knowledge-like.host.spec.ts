import { afterEach, expect, it, vi } from 'vitest'
import { KnowledgeBaseApi } from '../src/knowledge-base.ts'

const active: KnowledgeBaseApi[] = []
afterEach(async () => {
  await Promise.all(active.splice(0).map(api => api.dispose()))
  vi.unstubAllGlobals()
})

it('saves and removes likes through authenticated knowledge routes', async () => {
  const service = new KnowledgeBaseApi('http://backend.test', async () => 'token', 60000, { transcriptionModel: 'asr', chatModel: 'chat' })
  active.push(service)
  const fetch = vi.fn(async () => Response.json({ success: true }))
  vi.stubGlobal('fetch', fetch)
  const signal = new AbortController().signal
  await service.call('like', { id: 7 }, signal)
  await service.call('unlike', { id: 7 }, signal)
  expect(fetch.mock.calls).toMatchObject([
    ['http://backend.test/api/knowledge-bases/7/like', { method: 'POST' }],
    ['http://backend.test/api/knowledge-bases/7/like', { method: 'DELETE' }],
  ])
  await expect(service.call('like', { id: 'bad' }, signal)).rejects.toThrow()
  expect(fetch).toHaveBeenCalledTimes(2)
})
