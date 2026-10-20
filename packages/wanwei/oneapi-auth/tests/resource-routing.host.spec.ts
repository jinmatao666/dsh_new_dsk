import { afterEach, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { ResourceRouting } from '../src/resource-routing.ts'
import { resolveResourceSettings, type ResourceSettings } from '../src/resource-settings.ts'

let route: ResourceRouting | undefined
afterEach(() => { route?.restore(); route = undefined; vi.useRealTimers() })
const offline: ResourceSettings = { source: 'offline', proxyUrl: '', autoDetect: false, probeUrls: [] }
const proxy: ResourceSettings = { source: 'proxy', proxyUrl: 'http://relay.lan:3128', autoDetect: false,
  probeUrls: ['https://one.example/204', 'https://two.example/204'] }

it('rejects credentials, paths, missing probes and malformed fields', () => {
  expect(resolveResourceSettings(undefined)).toBeUndefined()
  for (const value of [null, {}, { ...proxy, proxyUrl: 'http://secret:secret@relay:3128' },
    { ...proxy, proxyUrl: 'http://relay:3128/path' }, { ...proxy, autoDetect: true, probeUrls: [] },
    { ...proxy, probeUrls: ['http://example.com'] }]) expect(() => resolveResourceSettings(value)).toThrow()
  expect(resolveResourceSettings(offline)).toEqual(offline)
})

it('validates managed transport and explicit internal bypass hosts', () => {
  const value: ResourceSettings = { ...proxy, transport: 'tunnel', proxyUrl: '', bypassHosts: ['10.10.1.20', 'files.internal', '::1'] }
  expect(resolveResourceSettings(value)).toEqual(value)
  for (const bypassHosts of [['http://internal'], ['internal:3300'], ['internal,path'], Array.from({ length: 33 }, () => 'internal')]) {
    expect(() => resolveResourceSettings({ ...value, bypassHosts })).toThrow()
  }
  route = new ResourceRouting('http://platform.lan')
  route.configure('intranet', value)
  expect(process.env.NO_PROXY).toContain('10.10.1.20,files.internal,::1')
})

it('passes exclusive offline settings to real children, switches cleanly, and restores environment', async () => {
  const original = process.env.PIP_FIND_LINKS
  const probe = vi.fn()
  route = new ResourceRouting('http://platform.lan:3300', probe)
  route.configure('intranet', offline)
  await route.prepare()
  const { stdout } = await promisify(execFile)(process.execPath, ['-e',
    'console.log(JSON.stringify({noIndex:process.env.PIP_NO_INDEX,links:process.env.PIP_FIND_LINKS,proxy:process.env.HTTPS_PROXY,bypass:process.env.NO_PROXY}))'],
  { windowsHide: true })
  expect(JSON.parse(stdout)).toEqual({ noIndex: '1', links: 'http://platform.lan:3300/api/desktop-resources/wheels/',
    proxy: 'http://127.0.0.1:9', bypass: 'localhost,127.0.0.1,::1,platform.lan' })
  expect(process.env.PIP_PROXY).toBeUndefined()
  expect(probe).not.toHaveBeenCalled()
  route.configure('intranet', proxy)
  await route.prepare()
  expect(process.env.PIP_FIND_LINKS).toBeUndefined()
  expect(process.env.PIP_NO_INDEX).toBeUndefined()
  expect(process.env.HTTPS_PROXY).toBe(proxy.proxyUrl)
  expect(probe).not.toHaveBeenCalled()
  route.configure('internet', proxy)
  expect(process.env.PIP_FIND_LINKS).toBe(original)
})

it('requires all probes, caches results, and never falls back to offline', async () => {
  vi.useFakeTimers()
  const probe = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValue(true)
  route = new ResourceRouting('http://platform.lan', probe)
  route.configure('intranet', { ...proxy, autoDetect: true })
  await Promise.all([route.prepare(), route.prepare()])
  expect(probe).toHaveBeenCalledTimes(2)
  expect(process.env.HTTPS_PROXY).toBe(proxy.proxyUrl)
  await route.prepare()
  expect(probe).toHaveBeenCalledTimes(2)
  vi.advanceTimersByTime(60_001)
  await route.prepare()
  expect(probe).toHaveBeenCalledTimes(4)
  expect(process.env.HTTPS_PROXY).toBeUndefined()
  expect(process.env.PIP_FIND_LINKS).toBeUndefined()
  expect(process.env.PIP_NO_INDEX).toBeUndefined()
})

it('does not let an old connectivity result override a changed source', async () => {
  let finish: ((value: boolean) => void) | undefined
  const pending = new Promise<boolean>((resolve) => { finish = resolve })
  route = new ResourceRouting('http://platform.lan', () => pending)
  route.configure('intranet', { ...proxy, autoDetect: true })
  const ready = route.prepare()
  route.configure('intranet', offline)
  finish?.(true)
  await ready
  expect(process.env.PIP_NO_INDEX).toBe('1')
  expect(process.env.HTTPS_PROXY).toBe('http://127.0.0.1:9')
})

it('routes a real Python HTTP request through the selected relay, not target DNS', async () => {
  const paths: string[] = []
  const server = createServer((req, res) => { paths.push(req.url ?? ''); res.end('relay-resource-ok') })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  try {
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Missing relay address')
    route = new ResourceRouting('http://platform.lan')
    route.configure('intranet', { ...proxy, proxyUrl: `http://127.0.0.1:${address.port}` })
    const { stdout } = await promisify(execFile)('python', ['-c',
      'import urllib.request; print(urllib.request.urlopen("http://unresolvable.invalid/resource", timeout=3).read().decode())'],
    { windowsHide: true, timeout: 10_000 })
    expect(stdout.trim()).toBe('relay-resource-ok')
    expect(paths).toEqual(['http://unresolvable.invalid/resource'])
  } finally {
    await new Promise<void>((resolve, reject) => { server.close((error) => {
      if (error) reject(error)
      else resolve()
    }) })
  }
})
