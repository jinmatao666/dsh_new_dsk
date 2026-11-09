import { lookup } from 'node:dns/promises'
import { createServer, request, type IncomingHttpHeaders } from 'node:http'
import { connect, isIP } from 'node:net'
import type { Socket } from 'node:net'

interface BrowserProxy {
  address: string
  reset(): void
  close(): void
}

async function resolveTarget(url: URL, policy: (url: URL) => boolean | undefined): Promise<string> {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid browser proxy target')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const allowed = policy(url)
  if (allowed === undefined) return host
  if (!allowed) throw new Error('Browser destination is outside the intranet')
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (!addresses.length || addresses.some(({ address }) => policy(new URL(
    url.protocol + '//' + (address.includes(':') ? '[' + address + ']' : address),
  )) !== true)) throw new Error('Browser destination resolves outside the intranet')
  return addresses[0]?.address ?? host
}

/**
 * Route browser HTTP and HTTPS through the current desktop network policy.
 * @param policy - current deployment policy, read for every new destination.
 * @returns a loopback proxy and socket lifecycle controls.
 */
export async function startBrowserProxy(policy: (url: URL) => boolean | undefined): Promise<BrowserProxy> {
  const sockets = new Set<Socket>()
  const reset = (): void => { for (const socket of sockets) socket.destroy() }
  const server = createServer((incoming, response) => {
    void (async () => {
      const url = new URL(incoming.url ?? '')
      if (url.protocol !== 'http:') throw new Error('Expected a plain HTTP request')
      const host = await resolveTarget(url, policy)
      if (response.destroyed) return
      const headers: IncomingHttpHeaders = { ...incoming.headers, host: url.host }
      delete headers['proxy-authorization']
      delete headers['proxy-connection']
      const upstream = request({ hostname: host, port: url.port || 80, method: incoming.method,
        path: url.pathname + url.search, headers }, (remote) => {
        response.writeHead(remote.statusCode ?? 502, remote.headers)
        remote.pipe(response)
      })
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end() })
      response.on('close', () => upstream.destroy())
      incoming.pipe(upstream)
    })().catch(() => { if (!response.destroyed) { response.writeHead(403); response.end() } })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => { sockets.delete(socket) })
  })
  server.on('connect', (incoming, client, head) => {
    void (async () => {
      const url = new URL('https://' + (incoming.url ?? ''))
      const host = await resolveTarget(url, policy)
      if (client.destroyed) return
      const upstream = connect(Number(url.port || 443), host)
      upstream.once('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) upstream.write(head)
        client.pipe(upstream).pipe(client)
      })
      upstream.on('error', () => client.destroy())
      upstream.on('close', () => client.destroy())
      client.on('error', () => upstream.destroy())
      client.on('close', () => upstream.destroy())
    })().catch(() => client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') { server.close(); throw new Error('Browser proxy did not bind') }
  return { address: 'http://127.0.0.1:' + String(address.port), reset,
    close() { reset(); server.close() } }
}
