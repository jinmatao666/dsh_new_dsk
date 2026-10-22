/** Bounded RPC chunks are spooled to a private file instead of a whole-file JSON array. */
import { randomUUID } from 'node:crypto'
import { openAsBlob } from 'node:fs'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MAX_FILE_BYTES = 1024 * 1024 * 1024
const MAX_CHUNK_BYTES = 1024 * 1024

interface UploadState {
  id: string
  directory: string
  path: string
  size: number
  received: number
  name: string
  type: string
  library: number
  parentPath: string
}

/** Owns one sequential upload and removes its private spool on failure, expiry or disposal. */
export class KnowledgeUpload {
  private current: UploadState | undefined
  private timer?: ReturnType<typeof setTimeout>
  private active: Promise<unknown> | undefined
  private disposed = false
  private readonly abort = new AbortController()

  constructor(private readonly timeoutMs: number) {}

  /** Execute one chunk operation; concurrent requests are rejected without changing the active file.
   * @param operation - Begin, append, finish or abort operation.
   * @param value - Untrusted RPC metadata or one bounded byte array.
   * @param signal - Caller cancellation.
   * @param upload - Authenticated multipart sender, called only after all bytes arrive.
   * @returns Upload identifier, acknowledgement or upstream document metadata.
   */
  async call(operation: string, value: Record<string, unknown>, signal: AbortSignal,
    upload: (library: number, form: FormData, signal: AbortSignal) => Promise<unknown>): Promise<unknown> {
    if (this.disposed) throw new Error('知识库上传已关闭')
    if (this.active !== undefined) throw new Error('知识库上传正在处理中')
    clearTimeout(this.timer)
    const task = this.execute(operation, value, AbortSignal.any([signal, this.abort.signal]), upload)
    this.active = task
    try {
      return await task
    } catch (error) {
      if (this.current !== undefined && value.uploadId === this.current.id) await this.cleanup()
      throw error
    } finally {
      this.active = undefined
      this.scheduleExpiry()
    }
  }

  private scheduleExpiry(): void {
    if (this.current === undefined || this.disposed) return
    const uploadId = this.current.id
    this.timer = setTimeout(() => {
      void this.call('upload-abort', { uploadId }, this.abort.signal, () => Promise.resolve(null))
        .catch(() => { /* Expiry cleanup has no waiting caller. */ })
    }, this.timeoutMs)
    this.timer.unref()
  }

  private async execute(operation: string, value: Record<string, unknown>, signal: AbortSignal,
    upload: (library: number, form: FormData, signal: AbortSignal) => Promise<unknown>): Promise<unknown> {
    signal.throwIfAborted()
    if (operation === 'upload-begin') {
      if (this.current !== undefined) throw new Error('请等待当前文件上传完成')
      if (!Number.isSafeInteger(value.id) || (value.id as number) <= 0 ||
        typeof value.name !== 'string' || value.name === '' || value.name.length > 255 || /[\\/\0]/.test(value.name) ||
        !Number.isSafeInteger(value.size) || (value.size as number) < 0 || (value.size as number) > MAX_FILE_BYTES) {
        throw new Error('上传文件无效或超过 1GB')
      }
      const parentPath = typeof value.parentPath === 'string' ? value.parentPath.replace(/\\/g, '/').trim() : ''
      if (parentPath.length > 500 || parentPath.split('/').includes('..')) throw new Error('上传目录无效')
      const directory = await mkdtemp(join(tmpdir(), 'dsh-knowledge-'))
      this.current = { id: randomUUID(), directory, path: join(directory, 'upload'), size: value.size as number,
        received: 0, name: value.name, type: typeof value.type === 'string' ? value.type : '',
        library: value.id as number, parentPath }
      try {
        const file = await open(this.current.path, 'wx', 0o600)
        await file.close()
      } catch (error) {
        await this.cleanup()
        throw error
      }
      return { uploadId: this.current.id }
    }
    const current = this.current
    if (current === undefined || value.uploadId !== current.id) throw new Error('上传已失效，请重新选择文件')
    try {
      if (operation === 'upload-abort') {
        await this.cleanup()
        return null
      }
      if (operation === 'upload-chunk') {
        if (value.offset !== current.received || !Array.isArray(value.bytes) || value.bytes.length === 0 ||
          value.bytes.length > MAX_CHUNK_BYTES || current.received + value.bytes.length > current.size ||
          !value.bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
          throw new Error('上传分片无效，请重新上传')
        }
        const file = await open(current.path, 'a')
        try { await file.writeFile(Uint8Array.from(value.bytes as number[])) } finally { await file.close() }
        current.received += value.bytes.length
        return null
      }
      if (operation !== 'upload-finish' || current.received !== current.size) throw new Error('上传文件不完整')
      const form = new FormData()
      form.append('file', await openAsBlob(current.path, { type: current.type }), current.name)
      if (current.parentPath !== '') form.append('parent_path', current.parentPath)
      return await upload(current.library, form, signal)
    } finally {
      if (operation === 'upload-finish') await this.cleanup()
    }
  }

  private async cleanup(): Promise<void> {
    const current = this.current
    if (current !== undefined) await rm(current.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    this.current = undefined
  }

  /** Abort in-flight forwarding, wait for it to settle, and remove temporary data. */
  async dispose(): Promise<void> {
    this.disposed = true
    clearTimeout(this.timer)
    this.abort.abort()
    await this.active?.catch(() => { /* The operation caller receives its failure. */ })
    await this.cleanup()
  }
}
