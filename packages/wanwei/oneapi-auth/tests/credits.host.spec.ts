import { afterEach, expect, it, vi } from 'vitest'
import { creditsRequest } from '../src/credits.ts'
afterEach(() => vi.unstubAllGlobals())
it('keeps requests allowlisted and uses POST only for claims', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ success:true,data:{ enabled:true } })))
  vi.stubGlobal('fetch',fetcher)
  await creditsRequest('https://service.test','secret','claim',0,'all',new AbortController().signal)
  expect(fetcher.mock.calls[0]).toEqual(['https://service.test/api/user/self/checkin',expect.objectContaining({ method:'POST',redirect:'error' })])
  await expect(creditsRequest('https://service.test','secret','https://evil.test',0,'all',new AbortController().signal)).rejects.toThrow('未知积分操作')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
