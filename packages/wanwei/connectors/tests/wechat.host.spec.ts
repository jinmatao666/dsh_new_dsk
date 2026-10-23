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
