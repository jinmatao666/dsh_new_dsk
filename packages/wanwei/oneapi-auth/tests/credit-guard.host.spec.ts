import { afterEach, expect, it, vi } from 'vitest'
import { installCreditGuard } from '../src/credit-guard.ts'
afterEach(() => vi.unstubAllGlobals())
function mount(token = 'secret') {
  let handler!: (exec: unknown, next: () => Promise<unknown>) => Promise<unknown>
  const scope = { on: (_: string, value: typeof handler) => { handler = value } }
  const ctx = { inject: (_: unknown, callback: (scope: unknown) => void) => callback(scope) }
  installCreditGuard(ctx as never, 'https://platform.test', 'dsh-server', async () => token)
  return { run: (provider: string, next = vi.fn(async () => ({ kind: 'allow' }))) => ({
    next, result: handler({ agent: { options: { provider }, session: { events: [] } }, signal: new AbortController().signal }, next),
  }) }
}
it('blocks tool execution with terminal quota error when managed credits are empty', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, data: { enabled: true, available: false } })))
  const { result, next } = mount().run('dsh-server')
  await expect(result).rejects.toMatchObject({ code: 'QUOTA' })
  expect(next).not.toHaveBeenCalled()
})
it('allows funded tools and leaves local provider calls outside platform billing', async () => {
  const fetcher = vi.fn(async () => Response.json({ success: true, data: { enabled: true, available: true } }))
  vi.stubGlobal('fetch', fetcher)
  const guard = mount()
  await expect(guard.run('dsh-server').result).resolves.toEqual({ kind: 'allow' })
  await expect(guard.run('my-local-model').result).resolves.toEqual({ kind: 'allow' })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('fails closed when account balance cannot be verified', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false })))
  const { result, next } = mount().run('dsh-server')
  await expect(result).rejects.toThrow('无法确认积分余额')
  expect(next).not.toHaveBeenCalled()
})
