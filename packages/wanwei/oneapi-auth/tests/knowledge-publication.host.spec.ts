import { afterEach, expect, it, vi } from 'vitest'
import { KnowledgeBaseApi } from '../src/knowledge-base.ts'

const active: KnowledgeBaseApi[] = []
afterEach(async () => {
  await Promise.all(active.splice(0).map(api => api.dispose()))
  vi.unstubAllGlobals()
})

it('submits publication requests to the owner-only backend endpoint', async () => {
  const service = new KnowledgeBaseApi('http://backend.test', async () => 'token', 60000, { transcriptionModel: 'asr', chatModel: 'chat' })
  active.push(service)
  const fetch = vi.fn(async () => Response.json({ success: true, data: { id: 11, status: 'pending' } }))
  vi.stubGlobal('fetch', fetch)
  const signal = new AbortController().signal
  await service.call('publication', { id: 7 }, signal)
  await service.call('apply-publication', { id: 7, target: 'public', reason: '共享规范' }, signal)
  expect(fetch.mock.calls).toMatchObject([
    ['http://backend.test/api/knowledge-bases/7/publication', {}],
    ['http://backend.test/api/knowledge-bases/7/publication', { method: 'POST', body: JSON.stringify({ target: 'public', reason: '共享规范' }) }],
  ])
  await expect(service.call('apply-publication', { id: 7, target: 'public', reason: 'x'.repeat(501) }, signal)).rejects.toThrow()
  expect(fetch).toHaveBeenCalledTimes(2)
})
