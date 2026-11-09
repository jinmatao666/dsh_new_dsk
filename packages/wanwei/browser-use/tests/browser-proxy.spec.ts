import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import { expect, it } from 'vitest'
import { startBrowserProxy } from '../src/browser-proxy.ts'

it('allows local browser requests and denies public destinations after switching modes', async () => {
  const origin = createServer((_request, response) => { response.end('local') })
  await new Promise<void>((resolve) => { origin.listen(0, '127.0.0.1', resolve) })
  const address = origin.address()
  if (address === null || typeof address === 'string') throw new Error('Test server did not bind')
  let intranet = false
  const proxy = await startBrowserProxy(url => intranet ? url.hostname === '127.0.0.1' : undefined)
  const endpoint = new URL(proxy.address)
  const get = (target: string) => new Promise<[number, string]>((resolve, reject) => {
    const outgoing = request({ hostname: endpoint.hostname, port: endpoint.port, path: target, agent: false }, (response) => {
      let body = ''
      response.on('data', (part: Buffer) => { body += part.toString() })
      response.on('end', () => { resolve([response.statusCode ?? 0, body]) })
    })
    outgoing.on('error', reject)
    outgoing.end()
  })
  try {
    const local = 'http://127.0.0.1:' + String(address.port)
    expect(await get(local)).toEqual([200, 'local'])
    intranet = true
    proxy.reset()
    expect(await get(local)).toEqual([200, 'local'])
    expect(await get('http://external.invalid/')).toEqual([403, ''])
    const refusedTunnel = await new Promise<string>((resolve, reject) => {
      const socket = connect(Number(endpoint.port), endpoint.hostname, () => {
        socket.write('CONNECT external.invalid:443 HTTP/1.1\r\nHost: external.invalid:443\r\n\r\n')
      })
      socket.on('error', reject)
      socket.on('data', (data: Buffer) => { resolve(data.toString()); socket.destroy() })
    })
    expect(refusedTunnel).toContain('403 Forbidden')
  } finally {
    proxy.close()
    origin.close()
  }
})
