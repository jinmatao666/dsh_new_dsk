import { expect, it, vi } from 'vitest'
import { uploadKnowledgeFile } from '../src/client/upload.ts'

it('combines the current directory with uploaded folder paths', async () => {
  const call = vi.fn(async (operation: string, _payload: unknown) => operation === 'upload-begin' ? { uploadId: 'upload-1' } : null)
  const file = new File(['data'], '材料.txt', { type: 'text/plain' })
  Object.defineProperty(file, 'webkitRelativePath', { value: '本地目录/子目录/材料.txt' })
  await uploadKnowledgeFile(call, 1, file, '资料/空目录')
  expect(call.mock.calls[0]).toEqual(['upload-begin', {
    id: 1, name: '材料.txt', type: 'text/plain', size: 4, parentPath: '资料/空目录/本地目录/子目录',
  }])
  expect(call.mock.calls.at(-1)).toEqual(['upload-finish', { uploadId: 'upload-1' }])
})

it('keeps a root-level local file outside directories', async () => {
  const call = vi.fn(async (operation: string, _payload: unknown) => operation === 'upload-begin' ? { uploadId: 'upload-1' } : null)
  await uploadKnowledgeFile(call, 1, new File(['data'], '材料.txt'))
  expect(call.mock.calls[0]).toEqual(['upload-begin', { id: 1, name: '材料.txt', type: '', size: 4 }])
})
