/** Origin-checked bridge between the planning-lecture iframe and Host RPC. */
import type { RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import { productText } from './locales/product.ts'

/** Model selection read by the parent desktop, never by the embedded forum. */
export interface DesktopAnalysisSelection { provider: string; model: string; reasoningEffort?: string }

async function streamAnalysis(payload: object, signal: AbortSignal, onText: (text: string) => void) {
  const response = await fetch('/api/desktop-forum/stream', {
    method: 'POST', credentials: 'same-origin', redirect: 'error', signal,
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  })
  if (!response.ok || !response.body) throw new Error('Analysis stream unavailable')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        if (!line) continue
        const event = JSON.parse(line) as { type?: string; text?: unknown; result?: RpcResult<unknown> }
        if (event.type === 'delta' && typeof event.text === 'string') onText(event.text)
        if (event.type === 'result' && event.result) return event.result
      }
      if (done) throw new Error('Analysis stream ended without a result')
    }
  } finally { await reader.cancel(); reader.releaseLock() }
}

/**
 * Accept analysis only from the configured iframe and cancel it when the page is released.
 * @param frame - Planning-lecture iframe owned by this panel.
 * @param origin - Administrator-configured HTTP(S) origin.
 * @param readSelection - Read the model currently shown by the desktop selector.
 * @returns Disposer aborting active work and removing the message listener.
 */
export function connectForumAnalysis(frame: HTMLIFrameElement, origin: string,
  readSelection: () => Promise<DesktopAnalysisSelection>): () => void {
  let active: { id: string; controller: AbortController } | undefined
  const send = (value: object) => frame.contentWindow?.postMessage({ channel: 'wanwei-forum-ai-v1', ...value }, origin)
  const receive = (event: MessageEvent) => {
    if (event.origin !== origin || event.source !== frame.contentWindow) return
    const data = event.data as { channel?: unknown; type?: unknown; id?: unknown; payload?: unknown } | null
    if (data?.channel !== 'wanwei-forum-ai-v1') return
    if (typeof data.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(data.id)) return
    if (data.type === 'hello') { send({ type: 'ready', id: data.id }); return }
    if (data.type === 'cancel') {
      if (active?.id === data.id) { active.controller.abort(); active = undefined }
      return
    }
    if (data.type !== 'analyze') return
    if (active) {
      send({ type: 'error', id: data.id, message: productText('正在分析，请稍候') })
      return
    }
    const request = { id: data.id, controller: new AbortController() }
    active = request
    void readSelection().then((selection) => {
      request.controller.signal.throwIfAborted()
      const payload = {
        ...data.payload !== null && typeof data.payload === 'object' ? data.payload : {},
        selection,
      }
      return streamAnalysis(payload, request.controller.signal, (text) => {
        if (active === request && !request.controller.signal.aborted) send({ type: 'delta', id: request.id, text })
      })
    }).then((result) => {
      if (active !== request || request.controller.signal.aborted) return
      if (result.ok) send({ type: 'result', id: request.id, value: result.value })
      else send({ type: 'error', id: request.id, message: result.error.message })
    }).catch(() => {
      if (active === request && !request.controller.signal.aborted) {
        send({ type: 'error', id: request.id, message: productText('无法连接桌面分析服务，请稍后重试') })
      }
    }).finally(() => { if (active === request) active = undefined })
  }
  window.addEventListener('message', receive)
  const unload = () => { active?.controller.abort(); active = undefined }
  frame.addEventListener('load', unload)
  return () => {
    window.removeEventListener('message', receive)
    frame.removeEventListener('load', unload)
    unload()
  }
}
