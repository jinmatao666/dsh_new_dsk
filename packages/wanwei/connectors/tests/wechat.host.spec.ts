import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import {
  buildWeChatStatus,
  disconnectWeChat,
  invalidateWeChatStatusCache,
  loadWeChatCredentials,
  pollWeChatLogin,
  registerWeChatIlinkRpc,
  setWeChatFetchForTests,
  setWeChatQrFactoryForTests,
  startWeChatLogin,
  stopWeChatBridge,
  wechatCredentialPath,
} from '../src/wechat-ilink.ts'
import { apply, inject, name } from '../src/index.ts'

afterEach(() => {
  vi.restoreAllMocks()
  invalidateWeChatStatusCache()
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

    const after = disconnectWeChat(home)
    expect(after.authed).toBe(false)
    expect(existsSync(wechatCredentialPath(home))).toBe(false)
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
