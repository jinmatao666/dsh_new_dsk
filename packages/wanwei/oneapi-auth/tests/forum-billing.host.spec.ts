import { afterEach, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { installForumBilling, type ForumBilling } from '../src/forum-billing.ts'

afterEach(() => vi.unstubAllGlobals())

function fixture(respond: (path: string, body: Record<string, unknown>) => Response | Promise<Response>,
  resolveToken = async (): Promise<string | undefined> => 'private-account-token') {
  let service: ForumBilling
  let dispose: () => Promise<void>
  const calls: { path: string; body: Record<string, unknown>; credential: string | null }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.split('/analysis/')[1]!
    if (typeof init.body !== 'string') throw new Error('forum billing requires a JSON string body')
    const body = JSON.parse(init.body) as Record<string, unknown>
    calls.push({ path, body, credential: new Headers(init.headers).get('authorization') })
    return respond(path, body)
  }))
  installForumBilling({ provide: (_name: string, value: ForumBilling) => { service = value },
    effect: (setup: () => () => Promise<void>) => { dispose = setup() } } as never,
  'https://platform.test', resolveToken)
  return { get service() { return service! }, calls, dispose: () => dispose!() }
}

const input = { action: 'qa' as const, item: { id: 'a1', type: 'article' as const }, question: '核心要点是什么',
  version: 1, sessionId: SessionId('forum-session'), provider: 'managed', model: 'desktop-selected' }
const answer = { text: '原答案', provider: 'managed', model: 'desktop-selected' }
const reserved = () => Response.json({ success: true, data: { id: 'operation', state: 'running' }, lease: 'l'.repeat(72) })

it('quotes the account-owned fee and saves its answer with successful settlement', async () => {
  const h = fixture(path => path === 'quote' ? Response.json({ success: true, data: { credits: 1, version: 1, cached: false, action: 'qa' } })
    : path === 'begin' ? reserved() : Response.json({ success: true }))
  try {
    expect(await h.service.quote(input, new AbortController().signal)).toEqual({ credits: 1, version: 1, cached: false, action: 'qa' })
    const execute = vi.fn(async () => answer)
    expect(await h.service.run(input, new AbortController().signal, execute)).toEqual(answer)
    expect(h.calls[1]!.body).toMatchObject({ session_id: 'forum-session', managed_model: 'desktop-selected', version: 1 })
    expect(h.calls[2]!.body).toEqual({ lease: 'l'.repeat(72), status: 'succeeded', ...answer })
    expect(h.calls.every(call => call.credential === 'Bearer private-account-token')).toBe(true)
    expect(JSON.stringify(answer)).not.toContain('token')
    expect(execute).toHaveBeenCalledOnce()
  } finally { await h.dispose() }
})

it('returns a persistent original answer without making another model call or settlement', async () => {
  const h = fixture(() => Response.json({ success: true, data: { id: 'operation', state: 'succeeded', ...answer }, lease: '' }))
  try {
    const execute = vi.fn()
    expect(await h.service.run({ ...input, model: 'new-selection' }, new AbortController().signal, execute)).toEqual(answer)
    expect(execute).not.toHaveBeenCalled()
    expect(h.calls).toHaveLength(1)
  } finally { await h.dispose() }
})

it('does not return an earlier account answer after the login changes during cache lookup', async () => {
  let token = 'first-account'
  const h = fixture(() => {
    token = 'second-account'
    return Response.json({ success: true, data: { id: 'operation', state: 'succeeded', ...answer } })
  }, async () => token)
  try {
    const execute = vi.fn()
    await expect(h.service.run(input, new AbortController().signal, execute)).rejects.toThrow('登录账号已变化')
    expect(execute).not.toHaveBeenCalled()
  } finally { await h.dispose() }
})

it('waits for shared settlement work when another answer finishes during a pending confirmation', async () => {
  let sequence = 0
  let release: (() => void) | undefined
  const h = fixture((path) => {
    if (path === 'begin') return Response.json({ success: true, data: { id: `operation-${++sequence}`, state: 'running' },
      lease: 'l'.repeat(72) })
    if (path === 'operation-1/result') return new Promise<Response>((resolve) => {
      release = () => { resolve(Response.json({ success: true })) }
    })
    return Response.json({ success: true })
  })
  try {
    const first = h.service.run(input, new AbortController().signal, async () => answer)
    await vi.waitFor(() => { expect(release).toBeTypeOf('function') })
    const second = h.service.run({ ...input, question: '另一个问题' }, new AbortController().signal, async () => answer)
    await vi.waitFor(() => { expect(sequence).toBe(2) })
    release!()
    await expect(Promise.all([first, second])).resolves.toEqual([answer, answer])
    expect(h.calls.filter(call => call.path.endsWith('/result'))).toHaveLength(2)
  } finally { release?.(); await h.dispose() }
})

it.each(['failed', 'cancelled'])('refunds a %s model attempt using the same reservation', async (status) => {
  const h = fixture(path => path === 'begin' ? reserved() : Response.json({ success: true }))
  const controller = new AbortController()
  try {
    await expect(h.service.run(input, controller.signal, async () => {
      if (status === 'cancelled') controller.abort()
      throw new Error('model stopped')
    })).rejects.toThrow('model stopped')
    expect(h.calls.at(-1)!.body).toEqual({ lease: 'l'.repeat(72), status })
  } finally { await h.dispose() }
})

it('retries an unconfirmed success without refunding it or executing the model again', async () => {
  let available = false
  const h = fixture(path => path === 'begin' ? reserved() : available ? Response.json({ success: true })
    : Response.json({ success: false }, { status: 503 }))
  try {
    const execute = vi.fn(async () => answer)
    await expect(h.service.run(input, new AbortController().signal, execute)).rejects.toThrow('确认暂未完成')
    available = true
    await h.dispose()
    expect(execute).toHaveBeenCalledOnce()
    expect(h.calls.filter(call => call.path.endsWith('/result')).map(call => call.body.status)).toEqual(['succeeded', 'succeeded'])
  } finally { await h.dispose() }
})

it('stops before model execution when the quoted price changes', async () => {
  const h = fixture(() => Response.json({ success: false, code: 'PRICE_CHANGED' }, { status: 409 }))
  try {
    const execute = vi.fn()
    await expect(h.service.run(input, new AbortController().signal, execute)).rejects.toThrow('配置已变更')
    expect(execute).not.toHaveBeenCalled()
  } finally { await h.dispose() }
})

it('binds the selected model even when a custom provider points to the platform relay', async () => {
  const h = fixture(path => path === 'begin' ? reserved() : Response.json({ success: true }))
  try {
    await h.service.run({ ...input, provider: 'custom-platform-route' }, new AbortController().signal, async () => answer)
    expect(h.calls[0]!.body.managed_model).toBe('desktop-selected')
  } finally { await h.dispose() }
})
