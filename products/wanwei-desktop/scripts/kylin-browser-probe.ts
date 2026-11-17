import { RemoteStream } from '../../../packages/api/gateway/src/client/remote-stream.ts'
import { createAutomaticWorkspace, desktopInvoke } from '../../../packages/wanwei/connectors/src/client/try-session.ts'

// This keyless probe covers stream setup, delivery, restart and disposal using
// the production supervisor and native fetch cancellation in the embedded view.
Object.assign(window, { __WANWEI_KYLIN_GATEWAY_PROBE__: async () => {
  const check = (value: boolean, message: string) => { if (!value) throw new Error(message) }
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
