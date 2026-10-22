import { createPanelController, registerFeaturePanel } from '@deepseek-ai/dsh-wanwei-feature-panels/client'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle, RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import {
  KnowledgePage,
  type KnowledgeAnswerProgress,
  type KnowledgeApi,
  type KnowledgeBaseItem,
} from './KnowledgePage.tsx'
import { productText } from './locales/product.ts'
import { uploadKnowledgeFile } from './upload.ts'
import './page.css'

async function readKnowledgeStream(
  body: ReadableStream<Uint8Array>,
  onProgress?: (progress: KnowledgeAnswerProgress) => void,
  signal?: AbortSignal,
): Promise<{ answer: string; recommendations: string[] }> {
  const reader = body.getReader()
  const onAbort = () => {
    void reader.cancel().catch(() => {
      // Named: abort cancel is best-effort once the browser already closed the stream.
    })
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  const decoder = new TextDecoder()
  let buffer = ''
  let answer = ''
  let recommendations: string[] = []
  try {
    for (;;) {
      if (signal?.aborted === true) throw new DOMException('The operation was aborted.', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const separator = buffer.indexOf('\n\n')
        if (separator < 0) break
        const chunk = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        const line = chunk.split('\n').find(entry => entry.startsWith('data:'))
        if (line === undefined) continue
        const payload = line.slice('data:'.length).trim()
        if (payload === '' || payload === '[DONE]') continue
        let parsed: unknown
        try {
          parsed = JSON.parse(payload)
        } catch {
          throw new Error('知识库流式响应无效')
        }
        if (typeof parsed !== 'object' || parsed === null) throw new Error('知识库流式响应无效')
        const event = parsed as {
          answer?: unknown
          recommendations?: unknown
          done?: unknown
          error?: unknown
        }
        if (typeof event.error === 'string' && event.error !== '') throw new Error(event.error)
        if (typeof event.answer === 'string') answer = event.answer
        if (Array.isArray(event.recommendations) && event.recommendations.every(item => typeof item === 'string')) {
          recommendations = event.recommendations
        }
        const finished = event.done === true
        onProgress?.({
          answer,
          ...(recommendations.length > 0 || finished ? { recommendations } : {}),
          done: finished,
        })
        if (finished) {
          await reader.cancel().catch(() => {
            // Named: cancel after the final event is best-effort.
          })
          return { answer, recommendations }
        }
      }
    }
    if (answer === '') throw new Error('知识库流式响应未完成')
    onProgress?.({ answer, recommendations, done: true })
    return { answer, recommendations }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

function KnowledgeIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5A2.5 2.5 0 0 0 5 21.5v-17Z" />
    <path d="M5 19a2 2 0 0 1 2-2h12M9 7h6M9 11h6" />
  </svg>
}

function value(result: RpcResult<unknown>): unknown {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function knowledgeItem(raw: unknown): KnowledgeBaseItem {
  if (typeof raw !== 'object' || raw === null) throw new Error('知识库响应无效')
  const item = raw as Record<string, unknown>
  if (!Number.isInteger(item.id) || typeof item.name !== 'string' || typeof item.description !== 'string' ||
    (item.kind !== 'personal' && item.kind !== 'shared' && item.kind !== 'common') ||
    !Number.isInteger(item.owner_user_id)) {
    throw new Error('知识库响应字段无效')
  }
  return item as unknown as KnowledgeBaseItem
}

export const inject = ['slots', 'connection', 'wanweiNetwork']
/** Mount the authorized RAGFlow-backed knowledge library.
 * @param ctx - Product Client context.
 */
export function apply(ctx: Context): void {
  const controller = createPanelController(ctx, 'wanwei-knowledge-base')
  const connection = ctx.get('connection') as ConnectionHandle
  const call = async (operation: string, payload: unknown = {}) =>
    value(await connection.rpc.call('/desktop-knowledge-base', operation, payload))
  const api: KnowledgeApi = {
    async list() {
      const raw = await call('list')
      if (!Array.isArray(raw)) throw new Error('知识库列表无效')
      return raw.map(knowledgeItem)
    },
    async create(input) { return knowledgeItem(await call('create', input)) },
    async documents(id) {
      const raw = await call('documents', { id })
      if (!Array.isArray(raw)) throw new Error('知识库文件列表无效')
      return raw.map((item) => {
        if (typeof item !== 'object' || item === null) throw new Error('知识库文件无效')
        const document = item as Record<string, unknown>
        if (typeof document.id !== 'string' || typeof document.name !== 'string' ||
          typeof document.size !== 'number' || typeof document.run !== 'string' || typeof document.progress !== 'number') {
          throw new Error('知识库文件字段无效')
        }
        const location = typeof document.location === 'string' ? document.location : undefined
        return {
          id: document.id,
          name: document.name,
          size: document.size,
          run: document.run,
          progress: document.progress,
          ...(location !== undefined && location !== '' ? { location } : {}),
          ...(typeof document.create_time === 'number' ? { create_time: document.create_time } : {}),
          ...(typeof document.update_time === 'number' ? { update_time: document.update_time } : {}),
        }
      })
    },
    async chunks(knowledgeBaseId, documentId) {
      const raw = await call('chunks', { id: knowledgeBaseId, documentId })
      if (!Array.isArray(raw)) throw new Error('知识库文件内容无效')
      return raw.map((item) => {
        if (typeof item !== 'object' || item === null) throw new Error('知识库切片无效')
        const chunk = item as Record<string, unknown>
        if (typeof chunk.id !== 'string' || typeof chunk.content !== 'string') throw new Error('知识库切片字段无效')
        return { id: chunk.id, content: chunk.content }
      })
    },
    async download(knowledgeBaseId, documentId) {
      const raw = await call('download', { id: knowledgeBaseId, documentId })
      if (typeof raw !== 'object' || raw === null) throw new Error('知识库文件下载无效')
      const file = raw as { contentType?: unknown; bytes?: unknown }
      if (typeof file.contentType !== 'string' || !Array.isArray(file.bytes) ||
        file.bytes.length > 20 * 1024 * 1024 ||
        !file.bytes.every(byte => Number.isInteger(byte) && (byte as number) >= 0 && (byte as number) <= 255)) {
        throw new Error('知识库文件下载字段无效')
      }
      return { contentType: file.contentType, bytes: file.bytes as number[] }
    },
    async upload(id, file) {
      await uploadKnowledgeFile(call, id, file)
    },
    async delete(knowledgeBaseId, documentId) {
      await call('delete', { id: knowledgeBaseId, documentId })
    },
    async copy(knowledgeBaseId, documentId, targetId, conflictPolicy) {
      await call('copy', {
        id: knowledgeBaseId, documentId, targetId,
        ...(conflictPolicy === undefined ? {} : { conflictPolicy }),
      })
    },
    async move(knowledgeBaseId, documentId, targetId, conflictPolicy) {
      await call('move', {
        id: knowledgeBaseId, documentId, targetId,
        ...(conflictPolicy === undefined ? {} : { conflictPolicy }),
      })
    },
    async messages(knowledgeBaseId) {
      const raw = await call('messages', { id: knowledgeBaseId })
      if (!Array.isArray(raw)) throw new Error('知识库对话历史无效')
      return raw.map((item) => {
        if (typeof item !== 'object' || item === null) throw new Error('知识库对话消息无效')
        const message = item as Record<string, unknown>
        if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string') {
          throw new Error('知识库对话消息字段无效')
        }
        return { role: message.role, content: message.content }
      })
    },
    async complete(knowledgeBaseId, question, onProgress, signal) {
      const response = await fetch('/api/desktop-knowledge-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: knowledgeBaseId, question }),
        credentials: 'same-origin',
        ...(signal === undefined ? {} : { signal }),
      })
      const contentType = response.headers.get('content-type') ?? ''
      if (response.ok && contentType.includes('text/event-stream') && response.body !== null) {
        return readKnowledgeStream(response.body, onProgress, signal)
      }
      if (!response.ok) {
        let message = '知识库回答失败'
        try {
          const body: unknown = await response.json()
          if (typeof body === 'object' && body !== null) {
            const next = (body as { message?: unknown }).message
            if (typeof next === 'string' && next !== '') message = next
          }
        } catch {
          // Named: error responses may be empty or non-JSON.
        }
        throw new Error(message)
      }
      const raw = await call('chat-completions', { id: knowledgeBaseId, question })
      if (typeof raw !== 'object' || raw === null) throw new Error('知识库回答无效')
      const result = raw as { answer?: unknown; recommendations?: unknown }
      if (typeof result.answer !== 'string' || !Array.isArray(result.recommendations) ||
        !result.recommendations.every(item => typeof item === 'string')) throw new Error('知识库回答字段无效')
      const answer = { answer: result.answer, recommendations: result.recommendations }
      onProgress?.({ answer: answer.answer, recommendations: answer.recommendations, done: true })
      return answer
    },
  }
  registerFeaturePanel(ctx, 'skill-knowledge-base', 25, {
    controller,
    title: productText('知识库'),
    subtitle: productText('管理个人与共享资料，并基于授权内容发起问答'),
    visibility: ctx.wanweiNetwork.visibility('knowledgeBases'),
    Icon: KnowledgeIcon,
    hooks: { network: ctx.wanweiNetwork },
    renderContent: () => <KnowledgePage api={api} />,
  })
}
