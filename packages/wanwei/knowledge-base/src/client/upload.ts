/** Upload a File in bounded sequential RPC chunks; never read the whole file into a JSON array.
 * @param call - Authenticated knowledge-base RPC dispatcher.
 * @param id - Selected library identifier.
 * @param file - Browser file, optionally carrying a folder-relative path.
 * @returns Completion after the backend has accepted the assembled original file.
 */
export async function uploadKnowledgeFile(
  call: (operation: string, payload: unknown) => Promise<unknown>, id: number, file: File,
): Promise<void> {
  if (file.size > 1024 * 1024 * 1024) throw new Error('文件不能超过 1GB')
  const relative = file.webkitRelativePath ? file.webkitRelativePath.replace(/\\/g, '/') : file.name
  const segments = relative.split('/').filter(part => part !== '')
  const name = segments.pop() ?? file.name
  const parentPath = segments.join('/')
  const raw = await call('upload-begin', { id, name, type: file.type, size: file.size,
    ...(parentPath !== '' ? { parentPath } : {}) })
  if (typeof raw !== 'object' || raw === null || typeof (raw as { uploadId?: unknown }).uploadId !== 'string') {
    throw new Error('知识库上传响应无效')
  }
  const uploadId = (raw as { uploadId: string }).uploadId
  try {
    for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
      const bytes = [...new Uint8Array(await file.slice(offset, offset + 1024 * 1024).arrayBuffer())]
      await call('upload-chunk', { uploadId, offset, bytes })
    }
    await call('upload-finish', { uploadId })
  } catch (error) {
    try { await call('upload-abort', { uploadId }) } catch { /* The original upload error remains actionable. */ }
    throw error
  }
}
