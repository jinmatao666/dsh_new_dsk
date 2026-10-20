/**
 * Poll connector status while a browser login runs outside the WebView request.
 * A hidden page, or a few failed polls after the window returns, is not a CLI failure.
 */
import { isConnectorTransportError } from './dingtalk-api.ts'
import { productText } from './locales/product.ts'

/** Status fields the wait loop reads. Other connector fields pass through. */
export type ConnectorAuthorizationStatus = {
  authorizing?: boolean
  authorizeError?: string | null
}

const POLL_MS = 1000
const DEFAULT_TIMEOUT_MS = 10 * 60_000
const DEFAULT_VISIBLE_MISS_LIMIT = 5

/**
 * Wait until the document is visible again or `ms` elapses.
 * An already-visible page waits the full interval so the loop cannot spin.
 * @param ms - maximum wait before the next status poll.
 * @returns when the interval elapses or the page becomes visible.
 */
function waitForPoll(ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(finish, ms)
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') finish()
    }
    function finish(): void {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      resolve()
    }
    document.addEventListener('visibilitychange', onVisible)
  })
}

/**
 * Poll until the Host login flight finishes.
 * Transport failures while the system browser is focused are retried. After the
 * desktop window is visible again, a short run of failures is reported.
 * @param read - status RPC. Must not start another browser login.
 * @param options.wait - test override for the poll delay.
 * @param options.now - test override for the deadline clock.
 * @param options.timeoutMs - how long to wait for the CLI process.
 * @param options.visibleMissLimit - failed polls tolerated while the page is visible.
 * @param options.isVisible - test override for `document.visibilityState`.
 * @returns the first status whose login flight has finished.
 */
export async function waitForConnectorAuthorization<T extends ConnectorAuthorizationStatus>(
  read: () => Promise<T>,
  options?: {
    wait?: (ms: number) => Promise<void>
    now?: () => number
    timeoutMs?: number
    visibleMissLimit?: number
    isVisible?: () => boolean
  },
): Promise<T> {
  const wait = options?.wait ?? waitForPoll
  const now = options?.now ?? Date.now
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const visibleMissLimit = options?.visibleMissLimit ?? DEFAULT_VISIBLE_MISS_LIMIT
  const isVisible = options?.isVisible ?? (() => document.visibilityState === 'visible')
  const deadline = now() + timeoutMs
  let visibleMisses = 0
  while (now() < deadline) {
    await wait(POLL_MS)
    try {
      const status = await read()
      visibleMisses = 0
      if (status.authorizing !== true) {
        if (typeof status.authorizeError === 'string' && status.authorizeError !== '') {
          throw new Error(status.authorizeError)
        }
        return status
      }
    } catch (error) {
      if (!isConnectorTransportError(error)) throw error
      if (isVisible()) {
        visibleMisses += 1
        if (visibleMisses >= visibleMissLimit) throw error
      }
    }
  }
  throw new Error(productText('授权等待超时。请确认浏览器中的授权已完成，然后返回此窗口重试。'))
}
