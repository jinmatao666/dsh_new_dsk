/** Loopback HTTP proxy carrying HTTP and CONNECT streams through the managed WebSocket endpoint. */
import { createServer, request, type Server } from 'node:http'
import { Duplex } from 'node:stream'
import type { Socket } from 'node:net'
import WebSocket from 'ws'

/** Authentication is resolved on the Host for every connection, never passed to child processes. */
export interface TunnelSession {
  baseURL: string
  token: string
}

function targetOf(authority: string): { host: string; port: string } {
  const url = new URL(`https://${authority}`)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid CONNECT target')
  const port = url.port || '443'
  if (port !== '443' && port !== '80') throw new Error('Only HTTP(S) ports are supported')
  return { host: url.hostname.replace(/^\[|\]$/gu, ''), port }
}

/** Own one loopback listener and every active bridge, including pending handshakes. */
export class ResourceTunnel {
  private server: Server | undefined
  private starting: Promise<string> | undefined
  private proxyURL: string | undefined
  private closed = false
  private revision = 0
  private readonly peers = new Set<Duplex>()
  private readonly websockets = new Set<WebSocket>()

  constructor(private readonly session: () => Promise<TunnelSession>) {}

  /** Bind only to loopback on a system-assigned port; concurrent callers share readiness.
   * @returns Local proxy URL, never the server credential.
   */
  async start(): Promise<string> {
    if (this.closed) throw new Error('Resource tunnel disposed')
    if (this.proxyURL) return this.proxyURL
    if (this.starting) return this.starting
    this.starting = this.listen()
    try { return await this.starting } finally { this.starting = undefined }
  }

  private async listen(): Promise<string> {
    const server = createServer({ maxHeaderSize: 16 << 10 }, (req, res) => {
      if (req.headers.origin || this.closed) { res.writeHead(403).end(); return }
      let target: URL
      try {
        target = new URL(req.url ?? '')
        if (target.protocol !== 'http:' || target.username || target.password || (target.port && target.port !== '80')) {
          throw new Error('Invalid HTTP proxy target')
        }
      } catch { res.writeHead(400).end('Invalid HTTP proxy request'); return }
      const headers = { ...req.headers, host: target.host, connection: 'close' }
      Reflect.deleteProperty(headers, 'proxy-authorization')
      Reflect.deleteProperty(headers, 'proxy-connection')
      void this.open(target.hostname, '80').then((stream) => {
        if (res.destroyed) { stream.destroy(); return }
        const upstream = request(target, { method: req.method, headers, createConnection: () => stream }, (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers)
          response.pipe(res)
        })
        upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Resource relay unavailable') })
        req.on('aborted', () => { upstream.destroy() })
        res.on('close', () => { upstream.destroy() })
        req.pipe(upstream)
      }, () => { res.writeHead(502).end('Resource relay unavailable') })
    })
    this.server = server
    server.requestTimeout = 60_000
    server.headersTimeout = 15_000
    server.on('connection', (socket) => {
      if (this.closed) socket.destroy()
      else this.track(socket)
    })
    server.on('connect', (req, client, head) => {
      const socket = client as Socket
      if (req.headers.origin || this.closed) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return }
      let target: { host: string; port: string }
      try { target = targetOf(req.url ?? '') } catch { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return }
      socket.pause()
      void this.open(target.host, target.port).then((stream) => {
        if (socket.destroyed) { stream.destroy(); return }
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) stream.write(head)
        socket.pipe(stream).pipe(socket)
        socket.on('close', () => { stream.destroy() })
        stream.on('error', () => { socket.destroy() })
        stream.on('end', () => { socket.end() })
        socket.resume()
      }, () => { socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n') })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
    })
    if (this.closed) { await new Promise<void>(resolve => server.close(() => { resolve() })); throw new Error('Resource tunnel disposed') }
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing resource proxy address')
    this.proxyURL = `http://127.0.0.1:${address.port}`
    return this.proxyURL
  }

  private track(stream: Duplex): void {
    this.peers.add(stream)
    stream.on('error', () => { /* Stream consumers receive the connection failure; prevent unhandled socket errors. */ })
    stream.once('close', () => { this.peers.delete(stream) })
  }

  private async open(host: string, port: string): Promise<Duplex> {
    const revision = this.revision
    const session = await this.session()
    if (this.closed || revision !== this.revision) throw new Error('Resource tunnel disposed or changed')
    const url = new URL('/api/desktop-resources/tunnel', session.baseURL)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('host', host)
    url.searchParams.set('port', port)
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${session.token}` },
      handshakeTimeout: 12_000, maxPayload: 64 << 10, perMessageDeflate: false, followRedirects: false })
    this.websockets.add(ws)
    ws.once('close', () => { this.websockets.delete(ws) })
    return new Promise<Duplex>((resolve, reject) => {
      let ready = false
      const stream = new Duplex({
        read() { ws.resume() },
        write(chunk: Buffer, _encoding, done) {
          let offset = 0
          const send = (error?: Error) => {
            if (error || offset === chunk.length) { done(error); return }
            const part = chunk.subarray(offset, offset + (32 << 10)); offset += part.length
            ws.send(part, { binary: true }, send)
          }
          send()
        },
        final(done) { ws.close(); done() },
        destroy(error, done) { ws.terminate(); done(error) },
      })
      this.track(stream)
      const timer = setTimeout(() => { stream.destroy(new Error('Resource relay handshake timed out')) }, 15_000)
      const failed = () => {
        clearTimeout(timer)
        if (!ready) reject(new Error('Resource relay connection failed'))
      }
      ws.on('error', () => { failed(); stream.destroy(new Error('Resource relay connection failed')) })
      ws.on('close', () => { failed(); stream.push(null) })
      ws.on('message', (data, binary) => {
        const payload = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)
        if (!ready) {
          if (binary || payload.toString() !== '{"ready":true}') { failed(); stream.destroy(); return }
          ready = true; clearTimeout(timer); resolve(stream); return
        }
        if (!binary) { stream.destroy(new Error('Unexpected relay frame')); return }
        if (!stream.push(payload)) ws.pause()
      })
    })
  }

  /** Revoke existing connections on source changes without opening a direct fallback. */
  disconnect(): void {
    this.revision++
    for (const stream of this.peers) stream.destroy()
    for (const ws of this.websockets) ws.terminate()
  }

  /** Close all children and await listener shutdown.
   * @returns Completion after pending binds and active connections have ended.
   */
  async dispose(): Promise<void> {
    this.closed = true
    const closedPeers = [...this.peers].filter(peer => !peer.closed)
      .map(peer => new Promise<void>((resolve) => { peer.once('close', () => { resolve() }) }))
    const closedWebSockets = [...this.websockets].filter(ws => ws.readyState !== WebSocket.CLOSED)
      .map(ws => new Promise<void>((resolve) => { ws.once('close', () => { resolve() }) }))
    this.disconnect()
    try { await this.starting } catch { /* A bind invalidated by disposal has no listener to retain. */ }
    if (this.server?.listening) await new Promise<void>(resolve => this.server?.close(() => { resolve() }))
    await Promise.all([...closedPeers, ...closedWebSockets])
    this.proxyURL = undefined
  }
}
