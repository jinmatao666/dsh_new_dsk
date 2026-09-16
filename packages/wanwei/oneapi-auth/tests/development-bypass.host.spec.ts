import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, type Config } from '../src/index.ts'

const config: Config = {
  baseURL: 'http://127.0.0.1:3000',
  provider: 'dsh-server',
  credentialRef: 'DSH_ONEAPI_TOKEN',
  tokenName: 'DSH Desktop Auto Token',
  defaultInput: ['text'],
  developmentBypass: true,
}

const previousDevelopment = process.env.DSH_DESKTOP_DEVELOPMENT

afterEach(() => {
  if (previousDevelopment === undefined) delete process.env.DSH_DESKTOP_DEVELOPMENT
  else process.env.DSH_DESKTOP_DEVELOPMENT = previousDevelopment
})

describe('desktop development authentication', () => {
  it('rejects a bypass outside the Tauri debug shell', () => {
    delete process.env.DSH_DESKTOP_DEVELOPMENT
    expect(() => { apply(new Context(), config) })
      .toThrow('桌面开发认证旁路只能由 Tauri debug shell 启用')
  })

  it('keeps the real authentication RPC mounted while returning the development identity', async () => {
    process.env.DSH_DESKTOP_DEVELOPMENT = '1'
    const ctx = new Context()
    type Handler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>
    let handler: Handler | undefined
    ctx.provide('connection', {
      rpc: {
        handle(path: string, next: Handler) {
          expect(path).toBe('/desktop-auth')
          handler = next
          return async () => {}
        },
      },
    } as never)
    apply(ctx, config)

    const status = await handler?.('status', {}, new AbortController().signal)
    expect(status).toEqual({
      ok: true,
      value: { state: 'authenticated', models: [], username: '本地开发' },
    })
  })
})
