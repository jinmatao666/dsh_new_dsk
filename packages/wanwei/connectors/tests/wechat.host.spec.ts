import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import {
  buildWeChatStatus,
  disconnectWeChat,
  ensureWeChatDesktopSession,
  invalidateWeChatStatusCache,
  loadWeChatCredentials,
  pollWeChatLogin,
  registerWeChatIlinkRpc,
  resetWeChatDesktopSessionInflightForTests,
  setWeChatFetchForTests,
  setWeChatQrFactoryForTests,
  startWeChatBridge,
  startWeChatLogin,
  stopWeChatBridge,
  wechatCredentialPath,
  wechatDesktopSessionPath,
} from '../src/wechat-ilink.ts'
import { apply, inject, name } from '../src/index.ts'

afterEach(() => {
  vi.restoreAllMocks()
  invalidateWeChatStatusCache()
  resetWeChatDesktopSessionInflightForTests()
  stopWeChatBridge()
  setWeChatFetchForTests(null)
  setWeChatQrFactoryForTests(null)
  delete process.env.DSH_HOME
})

describe('WeChat Assistant Host helpers', () => {
  it('reports disconnected status without credentials', () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wechat-'))
    const status = buildWeChatStatus(home, { fresh: true })
    expect(status.authed).toBe(false)
    expect(status.bridgeRunning).toBe(false)
    expect(status.hint).toMatch(/连接/)
  })

  it('coalesces concurrent ensureWeChatDesktopSession into one create', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wechat-ensure-'))
    let creates = 0
    let releaseCreate!: () => void
    const createHold = new Promise<void>(resolve => { releaseCreate = resolve })
    const ctx = {
      workspaceRegistry: {
        create: async () => ({ id: 'ws-wechat', sessionIds: [] as string[] }),
      },
      sessionController: {
        resolveAgent: async () => ({ error: { code: 'session-not-found', message: 'missing' } }),
        create: async () => {
          creates += 1
          await createHold
          return { sessionId: 'wechat-only-session' }
        },
        rename: async () => {},
      },
    }
    const first = ensureWeChatDesktopSession(ctx as never, home)
    const second = ensureWeChatDesktopSession(ctx as never, home)
    releaseCreate()
    const [a, b] = await Promise.all([first, second])
    expect(a).toBe('wechat-only-session')
    expect(b).toBe('wechat-only-session')
    expect(creates).toBe(1)
    expect(JSON.parse(readFileSync(wechatDesktopSessionPath(home), 'utf8')).sessionId).toBe('wechat-only-session')
  })

  it('reuses the saved Session without renaming and never creates on a transient resume failure', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wechat-reuse-'))
    const pointer = wechatDesktopSessionPath(home)
    mkdirSync(dirname(pointer), { recursive: true })
    writeFileSync(pointer, `${JSON.stringify({ sessionId: 'wechat-saved' }, null, 2)}\n`)
    const create = vi.fn(async () => ({ sessionId: 'wechat-second' }))
    const rename = vi.fn(async () => {})
    let resolveResult: unknown = { agent: {} }
    const ctx = {
      workspaceRegistry: { create: async () => ({ id: 'ws-wechat', sessionIds: ['wechat-saved'] }) },
      sessionController: { resolveAgent: async () => resolveResult, create, rename },
    }
    await expect(ensureWeChatDesktopSession(ctx as never, home)).resolves.toBe('wechat-saved')
    expect(rename).not.toHaveBeenCalled()

    resolveResult = { error: { code: 'internal', message: 'resume failed' } }
    await expect(ensureWeChatDesktopSession(ctx as never, home)).rejects.toThrow('resume failed')
    expect(create).not.toHaveBeenCalled()
    expect(JSON.parse(readFileSync(pointer, 'utf8')).sessionId).toBe('wechat-saved')
  })

  it('replaces an archived saved Session instead of reviving it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wechat-archived-'))
    const pointer = wechatDesktopSessionPath(home)
    mkdirSync(dirname(pointer), { recursive: true })
    writeFileSync(pointer, `${JSON.stringify({ sessionId: 'wechat-old' }, null, 2)}\n`)
    const resolveAgent = vi.fn(async () => ({ agent: {} }))
    const create = vi.fn(async () => ({ sessionId: 'wechat-fresh' }))
    const ctx = {
      workspaceRegistry: {
        archivedSessionIds: ['wechat-old'],
        create: async () => ({ id: 'ws-wechat', sessionIds: ['wechat-old'] }),
      },
      sessionController: { resolveAgent, create, rename: async () => {} },
    }
    await expect(ensureWeChatDesktopSession(ctx as never, home)).resolves.toBe('wechat-fresh')
    expect(resolveAgent).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledTimes(1)
    expect(JSON.parse(readFileSync(pointer, 'utf8')).sessionId).toBe('wechat-fresh')
  })

  it('does not restart a running bridge for the same bot token', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wechat-bridge-'))
    mkdirSync(dirname(wechatCredentialPath(home)), { recursive: true })
    writeFileSync(wechatCredentialPath(home), JSON.stringify({
      botToken: 'tok', ilinkBotId: 'bot', ilinkUserId: null,
      baseUrl: 'https://ilinkai.weixin.qq.com', getUpdatesBuf: '', connectedAt: 1,
    }))
    const calls: string[] = []
    setWeChatFetchForTests((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('getupdates')) {
        await new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => { reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
        })
      }
      return new Response(JSON.stringify({ ret: 0 }), { status: 200 })
    }) as unknown as typeof fetch)
    const ctx = {
      logger: { warn: () => {} },
      workspaceRegistry: { create: async () => ({ id: 'ws', sessionIds: [] }) },
      sessionController: {
        resolveAgent: async () => ({ error: { code: 'session-not-found', message: '' } }),
        create: async () => ({ sessionId: 'wechat-s' }),
        rename: async () => {},
      },
    }
    startWeChatBridge(ctx as never, home)
    startWeChatBridge(ctx as never, home)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(calls.filter(url => url.includes('notifystart'))).toHaveLength(1)
    expect(calls.filter(url => url.includes('notifystop'))).toHaveLength(0)
    stopWeChatBridge()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(calls.filter(url => url.includes('notifystop'))).toHaveLength(1)
  })

  it('starts QR login, confirms, and disconnects', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wechat-login-'))
    process.env.DSH_HOME = home
    setWeChatQrFactoryForTests(async () => 'data:image/png;base64,qq')
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('get_bot_qrcode')) {
        return new Response(JSON.stringify({
          qrcode: 'qr-token',
          qrcode_img_content: 'https://ilinkai.weixin.qq.com/ilink/bot/demo',
        }), { status: 200 })
      }
      if (url.includes('get_qrcode_status')) {
        return new Response(JSON.stringify({
          status: 'confirmed',
          bot_token: 'bot-token-secret',
          ilink_bot_id: 'bot-id-1',
          ilink_user_id: 'user-id-1',
          baseurl: 'https://ilinkai.weixin.qq.com',
        }), { status: 200 })
      }
      if (url.includes('notifystart') || url.includes('notifystop') || url.includes('getupdates')) {
        return new Response(JSON.stringify({ ret: 0, msgs: [], get_updates_buf: 'buf' }), { status: 200 })
      }
      return new Response(`unexpected ${url} ${init?.method ?? ''}`, { status: 500 })
    })
    setWeChatFetchForTests(fetchMock as unknown as typeof fetch)

    const started = await startWeChatLogin(home)
    expect(started.sessionKey).toBeTypeOf('string')
    expect(started.qrDataUrl).toBe('data:image/png;base64,qq')
    expect(started.qrcodeUrl).toContain('ilinkai.weixin.qq.com')

    const polled = await pollWeChatLogin(home, started.sessionKey, undefined, () => {})
    expect(polled.phase).toBe('confirmed')
    expect(polled.status.authed).toBe(true)
    expect(existsSync(wechatCredentialPath(home))).toBe(true)
    const stored = loadWeChatCredentials(home)
    expect(stored?.ilinkBotId).toBe('bot-id-1')
    expect(stored?.botToken).toBe('bot-token-secret')
    expect(JSON.parse(readFileSync(wechatCredentialPath(home), 'utf8')).botToken).toBe('bot-token-secret')

    const sessionPointer = wechatDesktopSessionPath(home)
    mkdirSync(dirname(sessionPointer), { recursive: true })
    writeFileSync(sessionPointer, `${JSON.stringify({ sessionId: 'wechat-session-fixed' }, null, 2)}\n`)

    const after = disconnectWeChat(home)
    expect(after.authed).toBe(false)
    expect(existsSync(wechatCredentialPath(home))).toBe(false)
    // Unbind clears iLink credentials only; the fixed Session pointer survives reconnect.
    expect(existsSync(sessionPointer)).toBe(true)
    expect(JSON.parse(readFileSync(sessionPointer, 'utf8')).sessionId).toBe('wechat-session-fixed')
  })

  it('recovers confirmed when the login session is gone but credentials already landed', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wechat-recover-'))
    process.env.DSH_HOME = home
    setWeChatQrFactoryForTests(async () => 'data:image/png;base64,qq')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('get_bot_qrcode')) {
        return new Response(JSON.stringify({
          qrcode: 'qr-token',
          qrcode_img_content: 'https://ilinkai.weixin.qq.com/ilink/bot/demo',
        }), { status: 200 })
      }
      if (url.includes('get_qrcode_status')) {
        return new Response(JSON.stringify({
          status: 'confirmed',
          bot_token: 'bot-token-secret',
          ilink_bot_id: 'bot-id-1',
          baseurl: 'https://ilinkai.weixin.qq.com',
        }), { status: 200 })
      }
      if (url.includes('notifystart') || url.includes('notifystop') || url.includes('getupdates')) {
        return new Response(JSON.stringify({ ret: 0, msgs: [], get_updates_buf: 'buf' }), { status: 200 })
      }
      return new Response(`unexpected ${url}`, { status: 500 })
    })
    setWeChatFetchForTests(fetchMock as unknown as typeof fetch)
    const started = await startWeChatLogin(home)
    await pollWeChatLogin(home, started.sessionKey, undefined, () => {})
    const recovered = await pollWeChatLogin(home, started.sessionKey, undefined, () => {})
    expect(recovered.phase).toBe('confirmed')
    expect(recovered.status.authed).toBe(true)
  })

  it('re-polls when confirmed arrives before bot credentials', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wechat-cred-race-'))
    process.env.DSH_HOME = home
    setWeChatQrFactoryForTests(async () => 'data:image/png;base64,qq')
    let statusCalls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('get_bot_qrcode')) {
        return new Response(JSON.stringify({
          qrcode: 'qr-token',
          qrcode_img_content: 'https://ilinkai.weixin.qq.com/ilink/bot/demo',
        }), { status: 200 })
      }
      if (url.includes('get_qrcode_status')) {
        statusCalls += 1
        if (statusCalls === 1) {
          return new Response(JSON.stringify({ status: 'confirmed' }), { status: 200 })
        }
        return new Response(JSON.stringify({
          status: 'confirmed',
          bot_token: 'bot-token-late',
          ilink_bot_id: 'bot-id-late',
          baseurl: 'https://ilinkai.weixin.qq.com',
        }), { status: 200 })
      }
      if (url.includes('notifystart') || url.includes('notifystop') || url.includes('getupdates')) {
        return new Response(JSON.stringify({ ret: 0, msgs: [], get_updates_buf: 'buf' }), { status: 200 })
      }
      return new Response(`unexpected ${url}`, { status: 500 })
    })
    setWeChatFetchForTests(fetchMock as unknown as typeof fetch)
    const started = await startWeChatLogin(home)
    const polled = await pollWeChatLogin(home, started.sessionKey, undefined, () => {})
    expect(polled.phase).toBe('confirmed')
    expect(loadWeChatCredentials(home)?.botToken).toBe('bot-token-late')
    expect(statusCalls).toBeGreaterThan(1)
  })
})

type IlinkCall = { endpoint: string; body: Record<string, unknown> }

function bridgeHarness(options: {
  inbound: string[]
  ilink: (endpoint: string, body: Record<string, unknown>) => Promise<unknown>
  whenIdle?: () => Promise<void>
  prompt?: () => Promise<void>
}) {
  const home = mkdtempSync(join(tmpdir(), 'wanwei-wechat-typing-'))
  mkdirSync(dirname(wechatCredentialPath(home)), { recursive: true })
  writeFileSync(wechatCredentialPath(home), JSON.stringify({
    botToken: 'tok', ilinkBotId: 'bot', ilinkUserId: 'user-1',
    baseUrl: 'https://ilinkai.weixin.qq.com', getUpdatesBuf: '', connectedAt: 1,
  }))
  const calls: IlinkCall[] = []
  const warnings: string[] = []
  let delivered = false
  setWeChatFetchForTests((async (url: string, init?: RequestInit) => {
    const endpoint = url.replace(/^.*\/ilink\/bot\//, '')
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>
    calls.push({ endpoint, body })
    if (endpoint === 'getupdates') {
      if (!delivered) {
        delivered = true
        return new Response(JSON.stringify({
          ret: 0,
          msgs: options.inbound.map((text, index) => ({
            message_type: 1,
            from_user_id: 'user-1',
            context_token: `ctx-${index}`,
            item_list: [{ type: 1, text_item: { text } }],
          })),
        }), { status: 200 })
      }
      await new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => { reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
      })
    }
    return new Response(JSON.stringify(await options.ilink(endpoint, body)), { status: 200 })
  }) as unknown as typeof fetch)
  const events: unknown[] = []
  const agent = {
    session: { events },
    whenIdle: options.whenIdle ?? (async () => {}),
  }
  const ctx = {
    logger: { warn: (message: string) => { warnings.push(message) } },
    workspaceRegistry: { create: async () => ({ id: 'ws', sessionIds: ['wechat-s'] }) },
    sessionController: {
      resolveAgent: async () => ({ agent }),
      create: async () => ({ sessionId: 'wechat-s' }),
      rename: async () => {},
      prompt: async () => {
        await options.prompt?.()
        events.push(
          { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '已完成' }] } } },
          { type: 'turn/end', data: { reason: { kind: 'completed' } } },
        )
      },
    },
    sessions: { flush: async () => {} },
    permissionPresets: { set: () => {} },
  }
  startWeChatBridge(ctx as never, home)
  return { calls, warnings }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  expect(predicate()).toBe(true)
}

const typingStatuses = (calls: IlinkCall[]) =>
  calls.filter(call => call.endpoint === 'sendtyping').map(call => call.body.status)

describe('WeChat Assistant typing indicator', () => {
  it('shows typing with keepalive while the task runs and cancels before the reply', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      let releaseTask!: () => void
      const taskHold = new Promise<void>((resolve) => { releaseTask = resolve })
      let idleCalls = 0
      const { calls } = bridgeHarness({
        inbound: ['打开百度地图', '再查一下天气'],
        ilink: async endpoint => endpoint === 'getconfig' ? { ret: 0, typing_ticket: 'ticket-1' } : { ret: 0 },
        whenIdle: async () => {
          idleCalls += 1
          if (idleCalls === 1) await taskHold
        },
      })
      await waitFor(() => typingStatuses(calls).length === 1)
      expect(calls.find(call => call.endpoint === 'getconfig')?.body).toMatchObject({
        ilink_user_id: 'user-1', context_token: 'ctx-0',
      })
      expect(calls.filter(call => call.endpoint === 'sendmessage')).toHaveLength(0)
      vi.advanceTimersByTime(5_000)
      await waitFor(() => typingStatuses(calls).length === 2)
      releaseTask()
      await waitFor(() => calls.filter(call => call.endpoint === 'sendmessage').length === 2)
      await waitFor(() => typingStatuses(calls).length === 5)

      expect(typingStatuses(calls)).toEqual([1, 1, 2, 1, 2])
      const typing = calls.filter(call => call.endpoint === 'sendtyping')
      expect(typing.every(call => call.body.typing_ticket === 'ticket-1' && call.body.ilink_user_id === 'user-1')).toBe(true)
      expect(calls.filter(call => call.endpoint === 'getconfig')).toHaveLength(1)
      vi.advanceTimersByTime(20_000)
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(typingStatuses(calls)).toHaveLength(5)
    } finally {
      vi.useRealTimers()
    }
  })

  it('still replies when no typing ticket is available', async () => {
    let prompts = 0
    const harness = bridgeHarness({
      inbound: ['你好', '再来', '第三条'],
      ilink: async (endpoint) => {
        if (endpoint === 'getconfig') {
          const attempt = harness.calls.filter(call => call.endpoint === 'getconfig').length
          if (attempt === 1) return { ret: -1, errmsg: 'denied' }
          if (attempt === 2) return { ret: 0 }
          throw 'offline'
        }
        if (endpoint === 'sendmessage' && harness.calls.filter(call => call.endpoint === 'sendmessage').length === 1) {
          throw new Error('send down')
        }
        return { ret: 0 }
      },
      prompt: async () => {
        prompts += 1
        if (prompts === 3) throw 'disk full'
      },
    })
    const { calls, warnings } = harness
    await waitFor(() => calls.filter(call => call.endpoint === 'sendmessage').length === 3)
    await waitFor(() => warnings.length === 4)
    expect(typingStatuses(calls)).toEqual([])
    expect([...warnings].sort()).toEqual([
      '微信输入状态不可用：getconfig ret=-1 denied',
      '微信输入状态不可用：getconfig ret=0 ',
      '微信输入状态不可用：offline',
      '微信回复失败：send down',
    ].sort())
    const lastReply = calls.filter(call => call.endpoint === 'sendmessage').at(-1)!.body.msg as { item_list: Array<{ text_item: { text: string } }> }
    expect(lastReply.item_list[0]!.text_item.text).toBe('执行失败：disk full')
  })

  it('evicts a rejected ticket and keeps replying when typing or reply sends fail', async () => {
    const harness = bridgeHarness({
      inbound: ['第一条', '第二条'],
      ilink: async (endpoint, body) => {
        if (endpoint === 'getconfig') return { ret: 0, typing_ticket: `ticket-${harness.calls.filter(call => call.endpoint === 'getconfig').length}` }
        if (endpoint === 'sendtyping') {
          if (body.typing_ticket === 'ticket-1') return { ret: -14, errmsg: 'expired' }
          if (body.status === 2) throw 'socket closed'
          return {}
        }
        if (endpoint === 'sendmessage' && harness.calls.filter(call => call.endpoint === 'sendmessage').length === 2) {
          throw 'send down'
        }
        return { ret: 0 }
      },
      prompt: async () => {
        if (harness.calls.filter(call => call.endpoint === 'getconfig').length === 1) {
          await waitFor(() => harness.warnings.length === 1)
          throw new Error('model busy')
        }
      },
    })
    const { calls, warnings } = harness
    await waitFor(() => calls.filter(call => call.endpoint === 'sendmessage').length === 2)
    await waitFor(() => warnings.some(message => message.startsWith('微信回复失败')))
    await waitFor(() => warnings.includes('微信输入状态发送失败：socket closed'))
    expect(calls.filter(call => call.endpoint === 'getconfig')).toHaveLength(2)
    expect(warnings).toContain('微信输入状态发送失败：sendtyping ret=-14 expired')
    expect(warnings).toContain('微信输入状态发送失败：socket closed')
    const replies = calls.filter(call => call.endpoint === 'sendmessage')
      .map(call => ((call.body.msg as { item_list: Array<{ text_item: { text: string } }> }).item_list[0]!.text_item.text))
    expect(replies[0]).toBe('执行失败：model busy')
  })

  it('replies without waiting on a hung typing ticket and cancels once it arrives', async () => {
    let releaseTicket!: () => void
    const ticketHold = new Promise<void>((resolve) => { releaseTicket = resolve })
    const { calls, warnings } = bridgeHarness({
      inbound: ['卡住的票据'],
      ilink: async (endpoint) => {
        if (endpoint === 'getconfig') {
          await ticketHold
          return { ret: 0, typing_ticket: 'late-ticket' }
        }
        if (endpoint === 'sendtyping') return { ret: 3 }
        return { ret: 0 }
      },
    })
    await waitFor(() => calls.filter(call => call.endpoint === 'sendmessage').length === 1)
    expect(typingStatuses(calls)).toEqual([])
    releaseTicket()
    await waitFor(() => typingStatuses(calls).length === 1)
    expect(typingStatuses(calls)).toEqual([2])
    await waitFor(() => warnings.length === 1)
    expect(warnings).toEqual(['微信输入状态发送失败：sendtyping ret=3 '])
  })

  it('stops keepalive after a rejected typing send', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      let releaseTask!: () => void
      const taskHold = new Promise<void>((resolve) => { releaseTask = resolve })
      const { calls, warnings } = bridgeHarness({
        inbound: ['失效的票据'],
        ilink: async endpoint => endpoint === 'getconfig'
          ? { ret: 0, typing_ticket: 'stale' }
          : endpoint === 'sendtyping' ? { ret: -14, errmsg: 'expired' } : { ret: 0 },
        whenIdle: () => taskHold,
      })
      await waitFor(() => warnings.length === 1)
      vi.advanceTimersByTime(15_000)
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(typingStatuses(calls)).toEqual([1])
      releaseTask()
      await waitFor(() => calls.filter(call => call.endpoint === 'sendmessage').length === 1)
      await waitFor(() => typingStatuses(calls).length === 2)
      expect(typingStatuses(calls)).toEqual([1, 2])
      expect(warnings).toEqual([
        '微信输入状态发送失败：sendtyping ret=-14 expired',
        '微信输入状态发送失败：sendtyping ret=-14 expired',
      ])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('WeChat Assistant RPC', () => {
  it('exports plugin metadata and mounts status RPC', async () => {
    expect(name).toBe('wanwei-connectors')
    expect(inject).toContain('connection')
    expect(inject).toContain('sessionController')
    const handlers = new Map<string, (endpoint: string, payload: unknown) => Promise<unknown>>()
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wechat-rpc-'))
    process.env.DSH_HOME = home
    const ctx = new Context()
    Object.assign(ctx, {
      logger: { warn: () => {}, info: () => {}, error: () => {} },
      get(key: string) {
        if (key === 'connection') {
          return {
            rpc: {
              handle: (channel: string, handler: (endpoint: string, payload: unknown) => Promise<unknown>) => {
                handlers.set(channel, handler)
                return () => undefined
              },
            },
          }
        }
        return undefined
      },
      effect(fn: () => () => void | Promise<void>) {
        return fn()
      },
      tools: { register: () => () => undefined },
    })
    apply(ctx as Context)
    expect(handlers.has('/wanwei-wechat')).toBe(true)
    const result = await handlers.get('/wanwei-wechat')!('status', {}) as {
      ok: true
      value: { authed: boolean; bridgeRunning: boolean }
    }
    expect(result.ok).toBe(true)
    expect(result.value.authed).toBe(false)

    registerWeChatIlinkRpc(ctx as Context)
    const unknown = await handlers.get('/wanwei-wechat')!('nope', {}) as { ok: false }
    expect(unknown.ok).toBe(false)
  })
})
