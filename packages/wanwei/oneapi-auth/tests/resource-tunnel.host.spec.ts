import { afterEach, expect, it } from 'vitest'
import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import { once } from 'node:events'
import { WebSocketServer } from 'ws'
import { ResourceTunnel } from '../src/resource-tunnel.ts'
import { ResourceRouting } from '../src/resource-routing.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function relay() {
  const target = createServer((req, res) => {
    const body: Buffer[] = []
    req.on('data', (part: Buffer) => { body.push(part) })
    req.on('end', () => {
      res.setHeader('x-target', 'fixture')
      res.end(`target:${req.url}:${Buffer.concat(body).toString()}`)
    })
  })
  target.listen(0, '127.0.0.1'); await once(target, 'listening')
  cleanup.push(() => new Promise<void>(resolve => target.close(() => { resolve() })))
  const targetAddress = target.address()
  if (!targetAddress || typeof targetAddress === 'string') throw new Error('No target address')
  const server = createServer()
  const sockets = new WebSocketServer({ noServer: true })
  const requests: Array<{ host: string | null; port: string | null; auth: string | undefined }> = []
  server.on('upgrade', (req, socket, head) => {
    if (req.headers.authorization !== 'Bearer fixture-token') { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return }
    const url = new URL(req.url ?? '', 'http://fixture')
    requests.push({ host: url.searchParams.get('host'), port: url.searchParams.get('port'), auth: req.headers.authorization })
    sockets.handleUpgrade(req, socket, head, (ws) => {
      const tcp = connect(targetAddress.port, '127.0.0.1')
      tcp.once('connect', () => { ws.send('{"ready":true}') })
      tcp.on('data', (data: Buffer) => { ws.send(data) })
      tcp.on('end', () => { ws.close() })
      tcp.on('error', () => { ws.terminate() })
      ws.on('message', (data) => { tcp.write(Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)) })
      ws.on('close', () => { tcp.destroy() })
      ws.on('error', () => { tcp.destroy() })
    })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  cleanup.push(async () => {
    for (const ws of sockets.clients) ws.terminate()
    await new Promise<void>((resolve) =>{  sockets.close(() => { resolve() }) })
    await new Promise<void>(resolve => server.close(() => { resolve() }))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No relay address')
  return { baseURL: `http://127.0.0.1:${address.port}`, requests }
}

async function proxyRequest(proxy: string, url: string, body?: string, origin?: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(proxy, { method: body ? 'POST' : 'GET', path: url, headers: origin ? { origin } : {} }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (data: Buffer) => { chunks.push(data) })
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }) })
    })
    req.on('error', reject)
    req.end(body)
  })
}

it('transports a real HTTP response and POST body through the managed relay without target DNS', async () => {
  const remote = await relay()
  const tunnel = new ResourceTunnel(async () => ({ baseURL: remote.baseURL, token: 'fixture-token' }))
  cleanup.push(() => tunnel.dispose())
  const [proxy, concurrent] = await Promise.all([tunnel.start(), tunnel.start()])
  expect(proxy).toBe(concurrent)
  expect(await proxyRequest(proxy, 'http://not-resolvable.invalid/data', 'uploaded-body')).toEqual({ status: 200, body: 'target:/data:uploaded-body' })
  expect(remote.requests).toEqual([{ host: 'not-resolvable.invalid', port: '80', auth: 'Bearer fixture-token' }])
  expect((await proxyRequest(proxy, 'http://not-resolvable.invalid/data', undefined, 'http://untrusted')).status).toBe(403)
})

it('supports CONNECT as an opaque bidirectional byte stream', async () => {
  const remote = await relay()
  const tunnel = new ResourceTunnel(async () => ({ baseURL: remote.baseURL, token: 'fixture-token' }))
  cleanup.push(() => tunnel.dispose())
  const proxy = new URL(await tunnel.start())
  const req = request({ host: proxy.hostname, port: proxy.port, method: 'CONNECT', path: 'not-resolvable.invalid:443' })
  const connected = new Promise<string>((resolve, reject) => {
    req.once('error', reject)
    req.once('connect', (res, socket, head) => {
      if (res.statusCode !== 200 || head.length) { socket.destroy(); reject(new Error('CONNECT failed')); return }
      let response = ''
      socket.on('data', (data) => { response += data.toString() })
      socket.on('end', () => { resolve(response) })
      socket.on('error', reject)
      socket.write('GET /through-connect HTTP/1.1\r\nHost: fixture\r\nConnection: close\r\n\r\n')
    })
  })
  req.end()
  expect(await connected).toContain('target:/through-connect:')
  expect(remote.requests[0]?.port).toBe('443')
})

it('returns failure rather than falling back to direct when credentials are rejected', async () => {
  const remote = await relay()
  const tunnel = new ResourceTunnel(async () => ({ baseURL: remote.baseURL, token: 'wrong' }))
  cleanup.push(() => tunnel.dispose())
  const proxy = await tunnel.start()
  expect((await proxyRequest(proxy, 'http://not-resolvable.invalid/data')).status).toBe(502)
  expect(remote.requests).toEqual([])
  await tunnel.dispose()
  await expect(tunnel.start()).rejects.toThrow('disposed')
})

it('applies managed loopback routing, rejects cross-origin credentials and restores on disposal', async () => {
  const remote = await relay()
  const original = process.env.HTTPS_PROXY
  const route = new ResourceRouting(remote.baseURL, undefined, async () => 'fixture-token')
  cleanup.push(() => route.dispose())
  route.configure('intranet', { source: 'proxy', transport: 'tunnel', proxyUrl: '', autoDetect: false, probeUrls: [] })
  await route.prepare()
  const proxy = process.env.HTTPS_PROXY
  expect(proxy).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u)
  expect((await proxyRequest(proxy ?? '', 'http://not-resolvable.invalid/route')).body).toContain('target:/route:')
  route.configure('intranet', { source: 'offline', proxyUrl: '', autoDetect: false, probeUrls: [] })
  expect(process.env.PIP_NO_INDEX).toBe('1')
  expect((await proxyRequest(proxy ?? '', 'http://not-resolvable.invalid/route')).status).toBe(502)
  route.configure('intranet', { source: 'proxy', transport: 'tunnel', proxyUrl: 'http://untrusted.invalid', autoDetect: false, probeUrls: [] })
  await expect(route.prepare()).rejects.toThrow('同源')
  await route.dispose()
  expect(process.env.HTTPS_PROXY).toBe(original)
})

it('does not retain a listener when disposal races startup', async () => {
  const tunnel = new ResourceTunnel(() => Promise.reject(new Error('No session')))
  const starting = tunnel.start()
  const disposed = tunnel.dispose()
  await expect(starting).rejects.toThrow('disposed')
  await disposed
})
