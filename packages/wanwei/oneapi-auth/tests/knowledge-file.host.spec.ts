import { afterEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeBaseApi } from '../src/knowledge-base.ts'

describe('KnowledgeBaseApi.streamFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serves the stored cover as an authenticated JPEG without accessing the original PDF', async () => {
    const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://one.example/api/knowledge-bases/9/documents/doc-1/cover')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token')
      return Response.json({ success: true, data: Buffer.from(jpeg).toString('base64') })
    })
    vi.stubGlobal('fetch', fetchMock)
    const api = new KnowledgeBaseApi('https://one.example', async () => 'token', 60_000, { transcriptionModel: 'asr', chatModel: 'chat' })
    const response = await api.streamFile(new Request(
      'https://desktop.local/api/desktop-knowledge-file?id=9&documentId=doc-1&cover=1',
    ))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpeg)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('proxies original document bytes without JSON-wrapping them and serves the next open from cache', async () => {
    const pdf = new Uint8Array([37, 80, 68, 70, 45, 49])
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://one.example/api/knowledge-bases/9/documents/doc-1/file')
      return new Response(pdf, {
        status: 200,
        headers: { 'content-type': 'application/pdf', 'content-length': String(pdf.byteLength) },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const api = new KnowledgeBaseApi('https://one.example', async () => 'token', 60_000, { transcriptionModel: 'asr', chatModel: 'chat' })
    const response = await api.streamFile(new Request(
      'https://desktop.local/api/desktop-knowledge-file?id=9&documentId=doc-1',
    ))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdf)
    const cached = await api.streamFile(new Request(
      'https://desktop.local/api/desktop-knowledge-file?id=9&documentId=doc-1',
    ))
    expect(new Uint8Array(await cached.arrayBuffer())).toEqual(pdf)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects missing auth and invalid document ids before contacting OneAPI', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const unauthenticated = new KnowledgeBaseApi('https://one.example', async () => undefined, 60_000, { transcriptionModel: 'asr', chatModel: 'chat' })
    const denied = await unauthenticated.streamFile(new Request(
      'https://desktop.local/api/desktop-knowledge-file?id=9&documentId=doc-1',
    ))
    expect(denied.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()

    const api = new KnowledgeBaseApi('https://one.example', async () => 'token', 60_000, { transcriptionModel: 'asr', chatModel: 'chat' })
    const invalid = await api.streamFile(new Request(
      'https://desktop.local/api/desktop-knowledge-file?id=9&documentId=../x',
    ))
    expect(invalid.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
