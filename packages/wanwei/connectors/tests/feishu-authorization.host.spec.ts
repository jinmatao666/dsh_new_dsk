import { EventEmitter } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { registerFeishu, type FeishuStatus } from '../src/feishu-cli.ts'

const native = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }))
vi.mock('node:child_process', () => native)
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
    expect((await rpc('status')).value.authorizationUrl).toBe('https://accounts.feishu.cn/verify?code=a%2fb')
    children[0]!.emit('close', 0)
    await vi.waitFor(() => expect(native.spawn).toHaveBeenCalledTimes(2))
    expect(native.spawn.mock.calls[1]![1]).toEqual(['auth', 'login', '--recommend', '--json'])
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
