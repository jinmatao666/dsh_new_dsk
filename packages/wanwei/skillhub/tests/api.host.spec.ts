import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillHubApi } from '../src/api.ts'

const config = { baseURL: 'https://api.skillhub.cn', timeoutMs: 1000, maxJsonBytes: 4096, maxArchiveBytes: 100, downloadHosts: ['downloads.example.com'] }
const entry = { slug: 'sample', name: 'Sample', description_zh: '说明', version: '1.0', labels: null, iconUrl: 'https://cloudcache.tencent-cloud.com/sample.png', downloads: 42 }
const detail = { skill: entry, latestVersion: { version: '1.0' }, owner: { handle: 'author' } }
const json = (value: unknown) => new Response(JSON.stringify(value))
afterEach(() => { vi.unstubAllGlobals() })

describe('SkillHub upstream adapter', () => {
  it.each([10001, 13000, 14422])('requests catalog page %s without an arbitrary upper limit', async (requestedPage) => {
    const fetcher = vi.fn(async (_url: URL) => json({ code: 0, data: { skills: [entry], total: 173064 } }))
    vi.stubGlobal('fetch', fetcher)
    const result = await new SkillHubApi(config).list({ page: requestedPage })
    expect(result.page).toBe(requestedPage)
    expect(result.items).toHaveLength(1)
    const url = new URL(String(fetcher.mock.calls[0]?.[0]))
    expect(url.searchParams.get('page')).toBe(String(requestedPage))
    expect(url.searchParams.get('pageSize')).toBe('12')
  })
  it.each([0, -1, 1.5, '13000', Number.MAX_SAFE_INTEGER + 1])('rejects invalid page %s before requesting upstream', async (page) => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(new SkillHubApi(config).list({ page })).rejects.toThrow('页码无效')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('projects real envelope fields and scopes pagination and searches', async () => {
    const fetcher = vi.fn(async (_url: URL) => json({ code: 0, data: { skills: [entry], total: 17 } }))
    vi.stubGlobal('fetch', fetcher)
    const page = await new SkillHubApi(config).list({ keyword: 'pdf', page: 2, category: 'office-efficiency' })
    expect(page).toMatchObject({ total: 17, page: 2, items: [{ slug: 'sample', summary: '说明', paid: false, iconUrl: entry.iconUrl, downloads: 42 }] })
    const url = new URL(String(fetcher.mock.calls[0]?.[0]))
    expect(url.searchParams.get('keyword')).toBe('pdf')
    expect(url.searchParams.get('page')).toBe('2')
  })
  it('reports rate limits without pretending an empty catalog is successful', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })))
    await expect(new SkillHubApi(config).list({})).rejects.toThrow('请求频繁')
  })
  it('bounds streamed bodies even without a Content-Length', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(4097))))
    await expect(new SkillHubApi(config).list({})).rejects.toThrow('大小限制')
  })
  it('follows only approved download redirects and pins the selected version', async () => {
    const calls: URL[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      calls.push(url)
      if (url.pathname.includes('/skills/')) return json(detail)
      if (url.pathname === '/api/v1/download') return new Response(null, { status: 302, headers: { location: 'https://downloads.example.com/sample.zip' } })
      return new Response('zip')
    }))
    const result = await new SkillHubApi(config).download({ slug: 'sample', version: '0.9' })
    expect(calls[1]?.searchParams.get('version')).toBe('0.9')
    expect(result).toMatchObject({ archive: 'emlw', slug: 'sample', version: '0.9' })
    expect(result.sha256).toHaveLength(64)
  })
  it.each(['http://downloads.example.com/a', 'https://untrusted.example/a', 'https://user:pass@downloads.example.com/a'])('rejects redirect %s before contacting it', async (location) => {
    const fetcher = vi.fn(async (url: URL) => url.pathname.includes('/skills/') ? json(detail) : new Response(null, { status: 302, headers: { location } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(new SkillHubApi(config).download({ slug: 'sample', version: '1.0' })).rejects.toThrow('允许范围')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('blocks paid packages and malformed caller identifiers before downloading', async () => {
    const fetcher = vi.fn(async () => json({ ...detail, skill: { ...entry, labels: { pricing_type: 'paid' } } }))
    vi.stubGlobal('fetch', fetcher)
    const api = new SkillHubApi(config)
    await expect(api.detail({ slug: '../private' })).rejects.toThrow('标识')
    expect(fetcher).not.toHaveBeenCalled()
    await expect(api.download({ slug: 'sample', version: '1' })).rejects.toThrow('购买')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('proxies bounded image bytes only from the approved Tencent icon host', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }))
    vi.stubGlobal('fetch', fetcher)
    const api = new SkillHubApi(config)
    await expect(api.icon({ url: entry.iconUrl })).resolves.toEqual({ dataUrl: 'data:image/png;base64,iVBORw==' })
    await expect(api.icon({ url: 'https://localhost/icon.png' })).rejects.toThrow('允许范围')
    await expect(api.icon({ url: 'http://cloudcache.tencent-cloud.com/icon.png' })).rejects.toThrow('允许范围')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
