import 'core-js/stable'
import { RemoteStream } from '../../../packages/api/gateway/src/client/remote-stream.ts'
import { createAutomaticWorkspace, desktopInvoke } from '../../../packages/wanwei/connectors/src/client/try-session.ts'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MarkdownText } from '../../../packages/client/ui-primitives/src/markdown/MarkdownText.tsx'

// This keyless probe covers stream setup, delivery, restart and disposal using
// the production supervisor and native fetch cancellation in the embedded view.
Object.assign(window, { __WANWEI_KYLIN_GATEWAY_PROBE__: async () => {
  const check = (value: boolean, message: string) => { if (!value) throw new Error(message) }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const labels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }
  try {
    const samples = [
      '你好！有什么我可以帮你的吗？',
      '你好！我在的，有什么需要帮忙的尽管说。',
      '哈哈，收到！我在听呢。有什么想了解、想弄的，尽管开口～',
      '**中文加粗！**继续\n\n- 列表内容\n\nhttps://example.com 和 test@example.com',
      '|列一|列二|\n|-|-|\n|内容|数据|\n\n```typescript\nconst value = 1\n```\n\n公式 $x^2$。',
    ]
    for (const text of samples) {
      for (const streaming of [true, false]) {
        flushSync(() => root.render(createElement(MarkdownText, { text, streaming, labels })))
        check((host.textContent?.length ?? 0) > 0, 'Assistant Markdown missing: ' + host.innerHTML)
        check(host.getBoundingClientRect().height > 0, 'Assistant Markdown has zero height')
        if (text.startsWith('你好') || text.startsWith('哈哈')) {
          check(host.textContent === text, 'Assistant reply changed')
        }
        if (text.includes('test@example.com')) {
          check(host.querySelector('a[href="mailto:test@example.com"]') !== null, 'GFM email autolink missing')
          check(host.querySelector('strong') !== null, 'Chinese strong emphasis missing')
        }
        if (text.startsWith('|')) {
          check(host.querySelector('table') !== null && host.querySelector('pre') !== null, 'Markdown table or code missing')
          if (!streaming) check(host.querySelector('.katex') !== null, 'Settled math missing')
        }
      }
    }
  } finally {
    root.unmount()
    host.remove()
  }
  const signals: AbortSignal[] = []
  const stream = new RemoteStream({ generation: {
    getSnapshot: () => undefined,
    subscribe: () => () => {},
  } }, {
    name: 'Kylin gateway probe',
    open: async function* (signal) {
      signals.push(signal)
      yield await fetch('/fixture', { signal }).then(response => response.json())
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason)
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    },
    ended: () => new Error('Unexpected probe stream end'),
  })
  const iterator = stream[Symbol.asyncIterator]()
  try {
    const first = await iterator.next()
    check(!first.done && typeof first.value.value.content === 'string', 'Gateway baseline missing')
    if (!first.done) first.value.accept()
    stream.restart()
    const second = await iterator.next()
    check(!second.done && second.value.generation === 2, 'Gateway restart failed')
    check(signals[0].aborted && !signals[1].aborted, 'Gateway generation cancellation failed')
    const pending = iterator.next()
    await stream.dispose()
    check((await pending).done === true && signals[1].aborted, 'Gateway disposal failed')
    const controller = new AbortController()
    const combined = AbortSignal.any([controller.signal, new AbortController().signal])
    controller.abort(new Error('Fetch cancelled by probe'))
    let rejected = false
    try { await fetch('/fixture', { signal: combined }) } catch { rejected = true }
    check(rejected, 'Fetch ignored combined cancellation')
    check(Array.isArray(await desktopInvoke('list_custom_skills', {})), 'Shared native skill client failed')
    check((await createAutomaticWorkspace()).includes('/workspaces/'), 'Shared first-send workspace allocation failed')
    return true
  } finally {
    await stream.dispose()
  }
} })
