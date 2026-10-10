import { Context } from '@deepseek-ai/cordis'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
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
  it.each([
    { baseURL: config.baseURL, environment: 'https://ignored.example.test', expected: 'https://oneapi.example.test/dsh-api' },
    { baseURL: undefined, environment: 'https://launch.example.test/api-root', expected: 'https://launch.example.test/api-root' },
    { baseURL: undefined, environment: undefined, expected: 'http://127.0.0.1:3000' },
  ])('resolves $expected and preserves the login/token/model protocol', async ({ baseURL, environment, expected }) => {
    const credentials = new Map<string, string>()
    const replace = vi.fn(() => Promise.resolve())
    const saveSelection = vi.fn(() => Promise.resolve())
    let handler: Handler | undefined
    const ctx = new Context()
    ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{
      source: 'process', values: environment === undefined ? {} : { DSH_ONEAPI_URL: environment },
    }]))
    ctx.provide('web', { registerSearchProvider: vi.fn() } as never)
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
    let networkMode = 'internet'
    const networkListeners = new Set<() => void>()
    ctx.provide('settings', { replace, register: () => ({
      get: () => ({ mode: networkMode }),
      watch: (listener: () => void) => { networkListeners.add(listener); return () => networkListeners.delete(listener) },
      update: async ({ mode }: { mode: string }) => { networkMode = mode; for (const listener of networkListeners) listener() },
    }) } as never)
    ctx.provide('agentDefaultModel', { saveSelection } as never)

    const requests: string[] = []
    let failDownloadReport = false
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      requests.push(url)
      if (url.endsWith('/api/skill/7/download')) {
        expect(init?.method).toBe('POST')
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer oneapi-token')
        if (failDownloadReport) return Promise.resolve(Response.json({ success: false, message: '下载量上报失败' }, { status: 500 }))
        return Promise.resolve(Response.json({ success: true }))
      }
      if (url.endsWith('/api/desktop-config')) {
        return Promise.resolve(Response.json({ success: true, data: { network: 'intranet', operator: '张运维', phone: '0571-12345678' } }))
      }
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

    apply(ctx, {
      ...(baseURL === undefined ? {} : { baseURL }),
      provider: config.provider,
      credentialRef: config.credentialRef,
      tokenName: config.tokenName,
      ...(config.defaultInput === undefined ? {} : { defaultInput: config.defaultInput }),
    })
    const result = await handler?.('login', { username: ' tester ', password: 'secret' }, new AbortController().signal)

    expect(result).toEqual({
      ok: true,
      value: { state: 'authenticated', models: ['model-text', 'model-vision'], username: 'tester' },
    })
    expect(requests).toEqual([
      `${expected}/api/user/login`,
      `${expected}/api/token/`,
      `${expected}/api/user/available_models/detail`,
      `${expected}/api/status`,
    ])
    expect(credentials.get('DSH_ONEAPI_TOKEN')).toBe('oneapi-token')
    expect(credentials.get('DSH_LOGIN_USERNAME')).toBe('tester')
    expect(replace).toHaveBeenCalledWith(expect.anything(), {
      providers: {
        'dsh-server': expect.objectContaining({
          apiKeyEnv: 'DSH_ONEAPI_TOKEN',
          baseURL: `${expected}/v1`,
          models: [
            { id: 'model-text', name: '文本模型', input: ['text'] },
            { id: 'model-vision', name: '视觉模型', input: ['text', 'image'] },
          ],
        }) as unknown,
      },
    })
    expect(saveSelection).toHaveBeenCalledWith({ provider: 'dsh-server', model: 'model-vision' })
    requests.length = 0
    expect(await handler?.('network-get', {}, new AbortController().signal)).toEqual({
      ok: true, value: {
        mode: 'intranet', internalOrigins: [new URL(expected).origin],
        features: { internet: { automations: true, connectors: true }, intranet: { automations: true, connectors: false } },
      },
    })
    expect(await handler?.('deployment-get', {}, new AbortController().signal)).toEqual({
      ok: true, value: {
        network: 'intranet', operator: '张运维', phone: '0571-12345678',
        features: { internet: { automations: true, connectors: true }, intranet: { automations: true, connectors: false } },
      },
    })
    expect(requests).toEqual([`${expected}/api/desktop-config`, `${expected}/api/desktop-config`])
    requests.length = 0
    for (let installation = 0; installation < 2; installation++) {
      expect(await handler?.('skill-download', { id: 7 }, new AbortController().signal)).toMatchObject({ ok: true })
    }
    expect(requests).toEqual([`${expected}/api/skill/7/download`, `${expected}/api/skill/7/download`])
    failDownloadReport = true
    expect(await handler?.('skill-download', { id: 7 }, new AbortController().signal)).toMatchObject({ ok: false })
    credentials.delete('DSH_ONEAPI_TOKEN')
    requests.length = 0
    expect(await handler?.('skill-download', { id: 7 }, new AbortController().signal)).toMatchObject({ ok: false })
    expect(requests).toEqual([])
  })
})
