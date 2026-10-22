import { KnowledgeUpload } from './knowledge-upload.ts'

/** Host-side proxy for authenticated knowledge-base operations. */
export class KnowledgeBaseApi {
  private readonly uploads: KnowledgeUpload

  constructor(private readonly baseURL: string, private readonly resolveToken: () => Promise<string | undefined>,
    uploadIdleTimeoutMs: number) {
    this.uploads = new KnowledgeUpload(uploadIdleTimeoutMs)
  }

  /** Wait for upload cancellation and remove private temporary files. */
  async dispose(): Promise<void> { await this.uploads.dispose() }

  private async request(path: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    const token = await this.resolveToken()
    if (token === undefined || token === '') throw new Error('请先登录后再使用知识库')
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${token}`)
    const response = await fetch(`${this.baseURL}${path}`, {
      ...init,
      headers,
      signal,
      redirect: 'error',
    })
    const text = await response.text()
    if (text.length > 16_777_216) throw new Error('知识库服务响应过大')
    const body: unknown = JSON.parse(text)
    if (typeof body !== 'object' || body === null) throw new Error('知识库服务响应无效')
    const envelope = body as { success?: unknown; data?: unknown; message?: unknown }
    if (!response.ok || envelope.success !== true) {
      throw new Error(typeof envelope.message === 'string' ? envelope.message : '知识库服务请求失败')
    }
    return envelope.data
  }

  /** Dispatch one validated desktop knowledge operation.
   * @param operation - RPC operation name.
   * @param payload - Browser-provided JSON payload.
   * @param signal - Request cancellation.
   * @returns OneAPI response data.
   */
  async call(operation: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
    const value = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {}
    if (['upload-begin', 'upload-chunk', 'upload-finish', 'upload-abort'].includes(operation)) {
      const token = await this.resolveToken()
      if (token === undefined || token === '') throw new Error('请先登录后再使用知识库')
      return this.uploads.call(operation, value, signal, (id, form, uploadSignal) =>
        this.request(`/api/knowledge-bases/${id}/documents`, { method: 'POST', body: form }, uploadSignal))
    }
    if (operation === 'list') return this.request('/api/knowledge-bases', {}, signal)
    if (operation === 'create') {
      return this.request('/api/knowledge-bases', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
      }, signal)
    }
    if (operation === 'documents') {
      const id = integer(value.id, '知识库编号')
      return this.request(`/api/knowledge-bases/${id}/documents`, {}, signal)
    }
    if (operation === 'chunks') {
      const id = integer(value.id, '知识库编号')
      const documentId = documentIdOf(value.documentId)
      return this.request(`/api/knowledge-bases/${id}/documents/${encodeURIComponent(documentId)}/chunks`, {}, signal)
    }
    if (operation === 'download') {
      const id = integer(value.id, '知识库编号')
      const documentId = documentIdOf(value.documentId)
      return this.downloadFile(`/api/knowledge-bases/${id}/documents/${encodeURIComponent(documentId)}/file`, signal)
    }
    if (operation === 'delete') {
      const id = integer(value.id, '知识库编号')
      const documentId = documentIdOf(value.documentId)
      return this.request(`/api/knowledge-bases/${id}/documents/${encodeURIComponent(documentId)}`, {
        method: 'DELETE',
      }, signal)
    }
    if (operation === 'copy' || operation === 'move') {
      const id = integer(value.id, '知识库编号')
      const documentId = documentIdOf(value.documentId)
      const targetId = integer(value.targetId, '目标知识库编号')
      const body: Record<string, unknown> = { target_knowledge_base_id: targetId }
      if (value.conflictPolicy === 'keep' || value.conflictPolicy === 'replace') {
        body.conflict_policy = value.conflictPolicy
      }
      return this.request(`/api/knowledge-bases/${id}/documents/${encodeURIComponent(documentId)}/${operation}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }, signal)
    }
    if (operation === 'messages') {
      const id = integer(value.id, '知识库编号')
      return this.request(`/api/knowledge-bases/${id}/chat/messages`, {}, signal)
    }
    if (operation === 'chat-completions' || operation === 'complete') {
      const id = integer(value.id, '知识库编号')
      if (typeof value.question !== 'string') throw new Error('问题无效')
      const body: Record<string, string> = { question: value.question }
      if (typeof value.model === 'string' && value.model.trim() !== '') body.model = value.model.trim()
      return this.request(`/api/knowledge-bases/${id}/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }, signal)
    }
    throw new Error(`未知知识库操作：${operation}`)
  }

  /** Proxy a streaming knowledge-base completion to the desktop Fetch route.
   * @param request - Authenticated browser request with JSON `{ id, question, model? }`.
   * @returns Upstream SSE response, or a JSON error response.
   */
  async streamChat(request: Request): Promise<Response> {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json({ success: false, message: '问题无效' }, { status: 400 })
    }
    const value = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
    let id: number
    try {
      id = integer(value.id, '知识库编号')
    } catch (error) {
      return Response.json({ success: false, message: error instanceof Error ? error.message : '知识库编号无效' }, { status: 400 })
    }
    if (typeof value.question !== 'string' || value.question.trim() === '') {
      return Response.json({ success: false, message: '问题无效' }, { status: 400 })
    }
    const payload: Record<string, unknown> = { question: value.question, stream: true }
    if (typeof value.model === 'string' && value.model.trim() !== '') payload.model = value.model.trim()
    const token = await this.resolveToken()
    if (token === undefined || token === '') {
      return Response.json({ success: false, message: '请先登录后再使用知识库' }, { status: 401 })
    }
    const upstream = await fetch(`${this.baseURL}/api/knowledge-bases/${id}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
      signal: request.signal,
      redirect: 'error',
    })
    if (!upstream.ok) {
      const text = await upstream.text()
      let message = '知识库服务请求失败'
      try {
        const parsed: unknown = JSON.parse(text)
        if (typeof parsed === 'object' && parsed !== null) {
          const next = (parsed as { message?: unknown }).message
          if (typeof next === 'string' && next !== '') message = next
        }
      } catch {
        // Named: upstream error bodies may be empty or non-JSON.
      }
      return Response.json({ success: false, message }, { status: upstream.status })
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
        'cache-control': 'no-cache',
      },
    })
  }

  private async downloadFile(path: string, signal: AbortSignal): Promise<{ contentType: string; bytes: number[] }> {
    const token = await this.resolveToken()
    if (token === undefined || token === '') throw new Error('请先登录后再使用知识库')
    const response = await fetch(`${this.baseURL}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      signal,
      redirect: 'error',
    })
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > 20 * 1024 * 1024) throw new Error('知识库文件超过 20MB')
    if (!response.ok) {
      let message = '知识库文件下载失败'
      try {
        const body: unknown = JSON.parse(new TextDecoder().decode(buffer))
        if (typeof body === 'object' && body !== null) {
          const next = (body as { message?: unknown }).message
          if (typeof next === 'string' && next !== '') message = next
        }
      } catch {
        // Named: download failures may return empty or non-JSON bodies.
      }
      throw new Error(message)
    }
    return {
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      bytes: [...new Uint8Array(buffer)],
    }
  }
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error(`${label}无效`)
  return value as number
}

function documentIdOf(value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.length > 64 || !/^[\w-]+$/.test(value)) {
    throw new Error('文件编号无效')
  }
  return value
}
