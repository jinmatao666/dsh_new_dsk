import { describe, expect, it, vi } from 'vitest'
import { createWeChatApi, parseWeChatStatus } from '../src/client/wechat-api.ts'

describe('wechat-api', () => {
  it('parses Host status payloads', () => {
    expect(parseWeChatStatus({
      authed: true,
      bridgeRunning: false,
      hint: 'x',
    })).toEqual({ authed: true, bridgeRunning: false, hint: 'x' })
    expect(() => parseWeChatStatus(null)).toThrow(/状态加载失败/)
  })

  it('calls /wanwei-wechat endpoints', async () => {
    const call = vi.fn(async (_channel: string, endpoint: string) => {
      if (endpoint === 'status') {
        return { ok: true, value: { authed: false, bridgeRunning: false, hint: null } }
      }
      if (endpoint === 'loginStart') {
        return {
          ok: true,
          value: {
            sessionKey: 's',
            qrcodeUrl: 'u',
            qrDataUrl: 'd',
            status: { authed: false, bridgeRunning: false, hint: null },
          },
        }
      }
      if (endpoint === 'loginPoll') {
        return {
          ok: true,
          value: {
            phase: 'wait',
            status: { authed: false, bridgeRunning: false, hint: null },
            message: null,
            qrcodeUrl: 'u',
            qrDataUrl: 'd',
          },
        }
      }
      return { ok: true, value: { authed: false, bridgeRunning: false, hint: null } }
    })
    const api = createWeChatApi({ rpc: { call } } as never)
    await expect(api.status()).resolves.toMatchObject({ authed: false })
    await expect(api.loginStart()).resolves.toMatchObject({ sessionKey: 's' })
    await expect(api.loginPoll('s')).resolves.toMatchObject({ phase: 'wait' })
    await expect(api.disconnect()).resolves.toMatchObject({ authed: false })
    expect(call).toHaveBeenCalledWith('/wanwei-wechat', 'loginPoll', { sessionKey: 's' })
  })
})
