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
 * True when the snapshot is already connected, even if the login process is still exiting.
 * @param status - polled connector status.
 * @returns whether desktop auth and the skill copy are both present.
 */
function connectedWhileAuthorizing(status: ConnectorAuthorizationStatus): boolean {
  const fields = status as ConnectorAuthorizationStatus & { authed?: boolean; skillInstalled?: boolean }
  return fields.authed === true && fields.skillInstalled === true
}

/**
 * Poll until the Host login flight finishes or the connector is already connected.
 * The packaged WebView stays `visible` while the system browser is in front, so a
 * dropped poll is retried until the Host flight finishes or the deadline passes.
 * @param read - status RPC. Must not start another browser login.
 * @param options.wait - test override for the poll delay.
 * @param options.now - test override for the deadline clock.
 * @param options.timeoutMs - how long to wait for the CLI process.
 * @returns the first settled status.
 */
export async function waitForConnectorAuthorization<T extends ConnectorAuthorizationStatus>(
  read: () => Promise<T>,
  options?: {
    wait?: (ms: number) => Promise<void>
    now?: () => number
    timeoutMs?: number
  },
): Promise<T> {
  const wait = options?.wait ?? waitForPoll
  const now = options?.now ?? Date.now
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const deadline = now() + timeoutMs
  while (now() < deadline) {
    await wait(POLL_MS)
    try {
      const status = await read()
      if (connectedWhileAuthorizing(status)) return status
      if (status.authorizing !== true) {
        if (typeof status.authorizeError === 'string' && status.authorizeError !== '') {
          throw new Error(status.authorizeError)
        }
        return status
      }
    } catch (error) {
      if (!isConnectorTransportError(error)) throw error
    }
  }
  throw new Error(productText('授权等待超时。请确认浏览器中的授权已完成，然后返回此窗口重试。'))
}
