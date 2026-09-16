import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, type Config } from '../src/index.ts'

const config: Config = {
  baseURL: 'https://oneapi.example.test/dsh-api',
  provider: 'dsh-server',
  credentialRef: 'DSH_ONEAPI_TOKEN',
  tokenName: 'DSH Desktop Auto Token',
  defaultInput: ['text'],
}

type Handler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OneAPI login flow', () => {
  it('reuses the server login, token, model-detail, and default-model protocol', async () => {
    const credentials = new Map<string, string>()
    const replace = vi.fn(() => Promise.resolve())
    const saveSelection = vi.fn(() => Promise.resolve())
    let handler: Handler | undefined
    const ctx = new Context()
    ctx.provide('connection', {
      rpc: {
        handle(path: string, next: Handler) {
          expect(path).toBe('/desktop-auth')
          handler = next
          return async () => {}
        },
      },
    } as never)
    ctx.provide('credentials', {
      resolve: (ref: string) => Promise.resolve(credentials.has(ref) ? { value: credentials.get(ref)! } : undefined),
      set: (ref: string, value: string) => {
        credentials.set(ref, value)
        return Promise.resolve()
      },
      unset: (ref: string) => {
        credentials.delete(ref)
        return Promise.resolve()
      },
    } as never)
    ctx.provide('settings', { replace } as never)
    ctx.provide('agentDefaultModel', { saveSelection } as never)

    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      requests.push(url)
      if (url.endsWith('/api/user/login')) {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { username: 'tester' } }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'set-cookie': 'session=wanwei-session; Path=/; HttpOnly' },
        }))
      }
      if (url.endsWith('/api/token/')) {
        return Promise.resolve(Response.json({ success: true, data: { key: 'oneapi-token' } }))
      }
      if (url.endsWith('/api/user/available_models/detail')) {
        return Promise.resolve(Response.json({
          success: true,
          data: [
            { id: 'model-text', name: '文本模型', modalities: { input: ['text'] } },
            { id: 'model-vision', name: '视觉模型', modalities: { input: ['text', 'image'] } },
          ],
        }))
      }
      if (url.endsWith('/api/status')) {
        return Promise.resolve(Response.json({ data: { default_model: 'model-vision' } }))
      }
      throw new Error(`unexpected request: ${url}`)
    }))

    apply(ctx, config)
    const result = await handler?.('login', { username: ' tester ', password: 'secret' }, new AbortController().signal)

    expect(result).toEqual({
      ok: true,
      value: { state: 'authenticated', models: ['model-text', 'model-vision'], username: 'tester' },
    })
    expect(requests).toEqual([
      'https://oneapi.example.test/dsh-api/api/user/login',
      'https://oneapi.example.test/dsh-api/api/token/',
      'https://oneapi.example.test/dsh-api/api/user/available_models/detail',
      'https://oneapi.example.test/dsh-api/api/status',
    ])
    expect(credentials.get('DSH_ONEAPI_TOKEN')).toBe('oneapi-token')
    expect(credentials.get('DSH_LOGIN_USERNAME')).toBe('tester')
    expect(replace).toHaveBeenCalledWith(expect.anything(), {
      providers: {
        'dsh-server': expect.objectContaining({
          apiKeyEnv: 'DSH_ONEAPI_TOKEN',
          baseURL: 'https://oneapi.example.test/dsh-api/v1',
          models: [
            { id: 'model-text', name: '文本模型', input: ['text'] },
            { id: 'model-vision', name: '视觉模型', input: ['text', 'image'] },
          ],
        }),
      },
    })
    expect(saveSelection).toHaveBeenCalledWith({ provider: 'dsh-server', model: 'model-vision' })
  })
})
