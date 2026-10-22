import { File } from 'node:buffer'
import { afterEach, expect, it, vi } from 'vitest'
import { KnowledgeBaseApi } from '../src/knowledge-base.ts'
import { uploadKnowledgeFile } from '../../knowledge-base/src/client/upload.ts'

const active: KnowledgeBaseApi[] = []
afterEach(async () => {
  await Promise.all(active.splice(0).map(api => api.dispose()))
  vi.unstubAllGlobals()
})

function api() {
  const service = new KnowledgeBaseApi('http://backend.test', async () => 'private-token', 60000)
  active.push(service)
  return service
}

it('uploads a file larger than 20MB through bounded chunks and file-backed multipart', async () => {
  const service = api()
  let seenSize = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe('http://backend.test/api/knowledge-bases/7/documents')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer private-token')
    const form = init.body as FormData
    const file = form.get('file') as Blob
    seenSize = file.size
    expect(await file.slice(0, 4).text()).toBe('MDB!')
    expect(form.get('parent_path')).toBe('资料')
    return Response.json({ success: true, data: [{ id: 'doc-1' }] })
  }))
  const file = new File(['MDB!', new Uint8Array(21 * 1024 * 1024)], '基础库.mdb')
  Object.defineProperty(file, 'webkitRelativePath', { value: '资料/基础库.mdb' })
  const wholeFile = vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('whole-file reads are forbidden'))
  let chunks = 0
  await uploadKnowledgeFile(async (operation, payload) => {
    if (operation === 'upload-chunk') {
      chunks++
      expect((payload as { bytes: number[] }).bytes.length).toBeLessThanOrEqual(1024 * 1024)
    }
    return service.call(operation, payload, new AbortController().signal)
  }, 7, file as unknown as globalThis.File)
  expect(seenSize).toBe(file.size)
  expect(chunks).toBe(22)
  expect(wholeFile).not.toHaveBeenCalled()
}, 30000)

it('accepts exactly 1GB metadata, rejects larger files and refuses incomplete finalization', async () => {
  const service = api()
  const call = (operation: string, payload: unknown) => service.call(operation, payload, new AbortController().signal)
  await expect(call('upload-begin', { id: 1, name: 'large.mdb', size: 1024 ** 3 + 1 })).rejects.toThrow('1GB')
  const started = await call('upload-begin', { id: 1, name: 'large.mdb', size: 1024 ** 3 }) as { uploadId: string }
  await expect(call('upload-finish', started)).rejects.toThrow('不完整')
  await expect(call('upload-chunk', { ...started, offset: 0, bytes: [1] })).rejects.toThrow('失效')
})

it('rejects out-of-order chunks and can begin a new upload after abort or forwarding failure', async () => {
  const service = api()
  const call = (operation: string, payload: unknown) => service.call(operation, payload, new AbortController().signal)
  let started = await call('upload-begin', { id: 1, name: 'a.mdb', size: 2 }) as { uploadId: string }
  await expect(call('upload-chunk', { ...started, offset: 1, bytes: [1] })).rejects.toThrow('分片无效')
  started = await call('upload-begin', { id: 1, name: 'a.mdb', size: 0 }) as { uploadId: string }
  await call('upload-abort', started)
  started = await call('upload-begin', { id: 1, name: 'a.mdb', size: 0 }) as { uploadId: string }
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false, message: '解析服务拒绝文件' }, { status: 502 })))
  await expect(call('upload-finish', started)).rejects.toThrow('解析服务拒绝文件')
  await expect(call('upload-begin', { id: 1, name: 'b.mdb', size: 0 })).resolves.toHaveProperty('uploadId')
})

it('does not reserve temporary storage for an unauthenticated caller', async () => {
  const service = new KnowledgeBaseApi('http://backend.test', async () => undefined, 60000)
  active.push(service)
  await expect(service.call('upload-begin', { id: 1, name: 'a.mdb', size: 1 }, new AbortController().signal)).rejects.toThrow('登录')
})

it('expires an idle upload without disabling subsequent uploads', async () => {
  const service = new KnowledgeBaseApi('http://backend.test', async () => 'token', 10)
  active.push(service)
  const call = (operation: string, payload: unknown) => service.call(operation, payload, new AbortController().signal)
  const started = await call('upload-begin', { id: 1, name: 'a.mdb', size: 1 })
  await new Promise(resolve => setTimeout(resolve, 80))
  await expect(call('upload-finish', started)).rejects.toThrow('失效')
  await expect(call('upload-begin', { id: 1, name: 'b.mdb', size: 1 })).resolves.toHaveProperty('uploadId')
})

it('rejects overlapping operations and waits for forwarding cancellation during disposal', async () => {
  const service = api()
  const call = (operation: string, payload: unknown) => service.call(operation, payload, new AbortController().signal)
  const started = await call('upload-begin', { id: 1, name: 'a.mdb', size: 0 })
  const forwarding = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => { reject(new Error('cancelled')) }, { once: true })
  }))
  vi.stubGlobal('fetch', forwarding)
  const finish = expect(call('upload-finish', started)).rejects.toThrow('cancelled')
  await vi.waitFor(() => { expect(forwarding).toHaveBeenCalled() })
  await expect(call('upload-begin', { id: 1, name: 'b.mdb', size: 0 })).rejects.toThrow('处理中')
  await service.dispose()
  await finish
  await expect(call('upload-begin', { id: 1, name: 'b.mdb', size: 0 })).rejects.toThrow('关闭')
})
