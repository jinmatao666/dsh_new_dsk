import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { testDraftModel } from '../src/test-draft-model.ts'

const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    server.closeAllConnections()
    server.close(() => { resolve() })
  })))
})

async function endpoint(status: number, response: unknown) {
  let request: { url?: string; auth?: string; body: string } | undefined
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      request = { url: req.url ?? '', auth: req.headers.authorization ?? req.headers['x-api-key'] as string ?? '', body }
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(response))
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('No test endpoint')
  return { url: `http://127.0.0.1:${address.port}/gateway/v1/`, request: () => request }
}

describe('draft model HTTP test', () => {
  it.each([
    ['openai-completions', 'chat/completions', { choices: [{ message: { content: 'OK' } }] }],
    ['openai-responses', 'responses', { output: [{ content: [{ text: 'OK' }] }] }],
    ['anthropic-messages', 'messages', { content: [{ type: 'text', text: 'OK' }] }],
  ])('sends the unsaved model with %s and preserves proxy prefixes', async (api, path, reply) => {
    const server = await endpoint(200, reply)
    await testDraftModel(server.url, api, 'private-model', 'probe-key', new AbortController().signal)
    expect(server.request()?.url).toBe(`/gateway/v1/${path}`)
    expect(JSON.parse(server.request()?.body ?? '{}')).toMatchObject({ model: 'private-model', stream: false })
    expect(server.request()?.auth).toBe(api === 'anthropic-messages' ? 'probe-key' : 'Bearer probe-key')
  })
  it('reports authentication failure without echoing a secret response body', async () => {
    const server = await endpoint(401, { error: 'probe-key' })
    await expect(testDraftModel(server.url, 'openai-completions', 'm', 'probe-key', new AbortController().signal))
      .rejects.toThrow('HTTP 401')
  })
  it('rejects a status or models-list response as a successful model test', async () => {
    const server = await endpoint(200, { data: [{ id: 'm' }] })
    await expect(testDraftModel(server.url, 'openai-completions', 'm', '', new AbortController().signal))
      .rejects.toThrow('no model response')
  })
})
