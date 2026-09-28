import { afterEach, describe, expect, it, vi } from 'vitest'
import { launchExpertWebsite, listPublishedExperts } from '../src/expert-catalog.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('Wanwei published expert catalog', () => {
  it('returns only the server-published roster without a local demo fallback', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: [{ key: 'geology-analysis' }] })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(listPublishedExperts('https://oneapi.test/')).resolves.toEqual({ items: [{ key: 'geology-analysis' }] })
    expect(fetchMock).toHaveBeenCalledWith('https://oneapi.test/api/expert-web/', { redirect: 'error' })
  })

  it('rejects server failures instead of displaying a misleading static roster', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, message: '目录未开放' }), { status: 503 })))
    await expect(listPublishedExperts('https://oneapi.test')).rejects.toThrow('目录未开放')
  })

  it('launches an HTTPS website with a Host-held token and returns only the one-use ticket', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, url: 'https://expert.test/workbench', ticket: 'once' })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(launchExpertWebsite('https://oneapi.test', 'geology-analysis', 'private-token')).resolves.toEqual({ url: 'https://expert.test/workbench', ticket: 'once' })
    expect(fetchMock).toHaveBeenCalledWith('https://oneapi.test/api/expert-web/geology-analysis/launch', expect.objectContaining({ method: 'POST', headers: { authorization: 'Bearer private-token' } }))
  })

  it('rejects an unsafe server-provided launch URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, url: 'file:///expert.html', ticket: 'once' }))))
    await expect(launchExpertWebsite('https://oneapi.test', 'geology-analysis', 'private-token')).rejects.toThrow('地址无效')
  })

  it('opens the configured HTTP deployment without upgrading or changing its port', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, url: 'http://ac.zjugis.com:3301/', ticket: 'once' }))))
    await expect(launchExpertWebsite('http://ac.zjugis.com:3300', 'meeting-minutes', 'private-token'))
      .resolves.toEqual({ url: 'http://ac.zjugis.com:3301/', ticket: 'once' })
  })
})
