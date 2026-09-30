import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'

afterEach(() => { vi.unstubAllGlobals() })
it('rejects every public RPC before I/O and restores the same handler in Internet mode', async () => {
  const ctx = new Context()
  let mode: 'internet' | 'intranet' = 'intranet'
  let handler!: (operation: string, payload: unknown, signal: AbortSignal) => Promise<unknown>
  ctx.provide('wanweiNetworkPolicy', { getSnapshot: () => ({ mode, internalOrigins: [] }), setMode: vi.fn() } as never)
  ctx.provide('connection', { rpc: { handle: (_path: string, next: typeof handler) => { handler = next; return () => {} } } } as never)
  const fetcher = vi.fn(async () => Response.json({ items: [{ key: 'office', name: '办公' }] }))
  vi.stubGlobal('fetch', fetcher)
  apply(ctx, { baseURL: 'https://api.skillhub.cn', timeoutMs: 1000, maxJsonBytes: 4096, maxArchiveBytes: 4096, downloadHosts: [] })
  for (const operation of ['list', 'categories', 'detail', 'icon', 'download']) {
    expect(await handler(operation, {}, new AbortController().signal)).toEqual({ ok: false, error: { code: 'internal', message: '纯内网环境不可用', details: {} } })
  }
  expect(fetcher).not.toHaveBeenCalled()
  mode = 'internet'
  expect(await handler('categories', {}, new AbortController().signal)).toEqual({ ok: true, value: { items: [{ key: 'office', name: '办公' }] } })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
