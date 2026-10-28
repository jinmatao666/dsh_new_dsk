import { EventEmitter } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { registerFeishu, type FeishuStatus } from '../src/feishu-cli.ts'

const native = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }))
vi.mock('node:child_process', () => native)
vi.mock('../src/feishu-skills.ts', () => ({ installFeishuSkills: vi.fn(), removeFeishuSkills: vi.fn() }))
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

it('first connect completes app setup before starting user authorization and retains a specific error', async () => {
  vi.stubEnv('DSH_LARK_CLI', process.execPath)
  native.execFile.mockImplementation((_command, _args, _options, callback) => {
    callback(null, JSON.stringify({ ok: false, error: { type: 'config', subtype: 'not_configured' } }), '')
  })
  const children: Array<EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean }> = []
  native.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true })
    children.push(child)
    return child
  })
  const handlers = new Map<string, (operation: string) => Promise<{ ok: boolean; value: FeishuStatus }>>()
  const ctx = new Context()
  ctx.provide('connection', { rpc: { handle(channel: string, handler: (operation: string) => Promise<{ ok: boolean; value: FeishuStatus }>) {
    handlers.set(channel, handler)
    return () => { handlers.delete(channel) }
  } } } as unknown as Context['connection'])
  ctx.provide('tools', { register: () => () => undefined } as unknown as Context['tools'])
  await ctx.plugin({ name: 'feishu-auth-test', inject: ['connection', 'tools'], apply: registerFeishu })
  try {
    const rpc = handlers.get('/wanwei-feishu')!
    expect((await rpc('login')).value.authorizing).toBe(true)
    await vi.waitFor(() => expect(native.spawn).toHaveBeenCalledTimes(1))
    expect(native.spawn.mock.calls[0]![1]).toEqual(['config', 'init', '--new'])
    children[0]!.stderr.emit('data', Buffer.from('  https://accounts.feishu.cn/verify?code=a%2fb\n'))
    expect((await rpc('status')).value).toMatchObject({ authorizationUrl: 'https://accounts.feishu.cn/verify?code=a%2fb', authorizationStage: 'configure' })
    children[0]!.emit('close', 0)
    await vi.waitFor(() => expect(native.spawn).toHaveBeenCalledTimes(2))
    expect(native.spawn.mock.calls[1]![1]).toEqual(['auth', 'login', '--recommend', '--json'])
    expect((await rpc('status')).value.authorizationStage).toBe('login')
    await rpc('login')
    expect(native.spawn).toHaveBeenCalledTimes(2)
    children[1]!.stdout.emit('data', Buffer.from('{"ok":false,"error":{"type":"authentication","subtype":"permission_denied","message":"SECRET"}}'))
    children[1]!.emit('close', 1)
    await vi.waitFor(async () => {
      const state = (await rpc('status')).value
      expect(state.authorizing).toBe(false)
      expect(state.error).toContain('authentication/permission_denied')
      expect(state.error).not.toContain('SECRET')
    })
    native.execFile.mockImplementation((_command, _args, _options, callback) => {
      callback(null, JSON.stringify({ ok: true, identities: { user: { available: false, status: 'not_logged_in' } } }), '')
    })
    await rpc('login')
    await vi.waitFor(() => expect(native.spawn).toHaveBeenCalledTimes(3))
    expect(native.spawn.mock.calls[2]![1]).toEqual(['auth', 'login', '--recommend', '--json'])
    children[2]!.emit('close', 0)
    await vi.waitFor(async () => { expect((await rpc('status')).value.authorizing).toBe(false) })
  } finally {
    children.forEach(child => child.emit('close', 0))
    await ctx.fiber.dispose()
  }
  expect(handlers.size).toBe(0)
})

it('treats exit 3 with a completed identity as partial authorization and repairs only the missing scopes', async () => {
  vi.stubEnv('DSH_LARK_CLI', process.execPath)
  vi.stubEnv('DSH_HOME', process.cwd())
  let granted = false
  let businessFailure = false
  native.execFile.mockImplementation((_command, args, _options, callback) => {
    if (args[0] === 'auth' && args[1] === 'status') {
      callback(null, JSON.stringify({ ok: true, identities: { user: { available: true, status: 'ready' } } }), '')
    } else if (args[0] === 'auth' && args[1] === 'check') {
      callback(granted ? null : { code: 1 }, JSON.stringify({ ok: granted, missing: granted ? [] : ['im:message.send_as_user'] }), '')
    } else {
      callback(businessFailure ? { code: 3 } : null, businessFailure ? '' : '{"ok":true}', businessFailure
        ? JSON.stringify({ ok: false, error: { type: 'authorization', subtype: 'missing_scope', missing_scopes: ['im:message.send_as_user'] } }) : '')
    }
  })
  const children: Array<EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean }> = []
  native.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true })
    children.push(child)
    return child
  })
  let rpc!: (operation: string) => Promise<{ ok: boolean; value: FeishuStatus }>
  let tool!: { execute: (args: { args: string[] }, exec: { signal: AbortSignal }) => Promise<string> }
  const ctx = new Context()
  ctx.provide('connection', { rpc: { handle: (_channel: string, handler: typeof rpc) => { rpc = handler; return () => {} } } } as unknown as Context['connection'])
  ctx.provide('tools', { register: (value: typeof tool) => { tool = value; return () => {} } } as unknown as Context['tools'])
  await ctx.plugin({ name: 'feishu-partial-auth-test', inject: ['connection', 'tools'], apply: registerFeishu })
  try {
    await rpc('login')
    await vi.waitFor(() => expect(children).toHaveLength(1))
    children[0]!.stdout.emit('data', Buffer.from('{"event":"device_authorization","verification_uri_complete":"https://accounts.feishu.cn/verify?code=first"}\n'))
    children[0]!.stderr.emit('data', Buffer.from('Waiting for authorization\n'))
    children[0]!.stdout.emit('data', Buffer.from('{"event":"authorization_complete","user_open_id":"PRIVATE","missing":["im:message.send_as_user"]}\n'))
    children[0]!.emit('close', 3)
    await vi.waitFor(async () => expect((await rpc('status')).value).toMatchObject({ authed: true, authorizing: false, error: null, missingScopes: ['im:message.send_as_user'] }))
    await rpc('login')
    await vi.waitFor(() => expect(children).toHaveLength(2))
    expect(native.spawn.mock.calls[1]![1]).toEqual(['auth', 'login', '--scope', 'im:message.send_as_user', '--json'])
    granted = true
    children[1]!.emit('close', 0)
    await vi.waitFor(async () => expect((await rpc('status')).value).toMatchObject({ authed: true, missingScopes: [], error: null }))
    businessFailure = true
    granted = false
    const result = await tool.execute({ args: ['im', '+messages-send', '--as', 'user'] }, { signal: new AbortController().signal })
    expect(JSON.parse(result).connectorAction).toContain('补充授权')
    expect((await rpc('status')).value.missingScopes).toEqual(['im:message.send_as_user'])
    await expect(tool.execute({ args: ['im', '+messages-send'] }, { signal: new AbortController().signal })).rejects.toThrow('补充授权')
    await rpc('authorize-messages')
    await vi.waitFor(() => expect(children).toHaveLength(3))
    expect(native.spawn.mock.calls[2]![1]).toEqual(['auth', 'login', '--scope', 'im:message.send_as_user', '--json'])
    granted = true
    children[2]!.emit('close', 0)
    await vi.waitFor(async () => expect((await rpc('status')).value.missingScopes).toEqual([]))
  } finally {
    children.forEach(child => child.emit('close', 0))
    await ctx.fiber.dispose()
  }
})
