import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createFeishuChannel, parseFeishuMessage } from '../src/feishu-channel.ts'

const native = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => native)
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
const event = (overrides = {}) => ({ type: 'im.message.receive_v1', sender_type: 'user', chat_type: 'p2p', message_type: 'text',
  message_id: 'om_first', chat_id: 'oc_owner', sender_id: 'ou_owner', create_time: String(Date.now() + 1000), content: '帮我整理项目资料', ...overrides })

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'wanwei-feishu-channel-'))
  const children: Array<EventEmitter & { stdout: EventEmitter
    stderr: EventEmitter
    stdin: { end: ReturnType<typeof vi.fn> }
    kill: ReturnType<typeof vi.fn> }> = []
  native.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(),
      stdin: { end: vi.fn(() => { queueMicrotask(() => child.emit('close', 0)) }) }, kill: vi.fn(() => { child.emit('close', 0); return true }) })
    children.push(child)
    return child
  })
  let owner = 'ou_owner'
  const run = vi.fn(async (args: readonly string[]) => ({ exitCode: 0, stderr: '', stdout: JSON.stringify(args[0] === 'auth'
    ? { appId: 'cli_demo', identities: { user: { available: true, status: 'ready', openId: owner } } } : { ok: true }) }))
  const events: unknown[] = []
  const agent = { session: { events }, whenIdle: vi.fn(async () => {}) }
  const workspaces = new Map<string, { id: string; sessionIds: string[] }>()
  const createWorkspace = vi.fn(async (cwd: string) => {
    if (!workspaces.has(cwd)) workspaces.set(cwd, { id: cwd, sessionIds: [] })
    return workspaces.get(cwd)!
  })
  const createSession = vi.fn(async ({ workspaceId }: { workspaceId: string }) => {
    const id = `session-${createSession.mock.calls.length}`
    workspaces.get(workspaceId)!.sessionIds.push(id)
    return { sessionId: id }
  })
  const prompt = vi.fn(async () => {
    events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '@literal-result.txt\n整理完成' }] } } },
      { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  })
  const cancel = vi.fn()
  const ctx = { workspaceRegistry: { create: createWorkspace, archivedSessionIds: [] },
    sessionController: { create: createSession, resolveAgent: async () => ({ agent }), rename: vi.fn(async () => {}), prompt, cancel },
    permissionPresets: { set: vi.fn() }, sessions: { flush: vi.fn(async () => {}) } } as unknown as Context
  const make = () => createFeishuChannel(ctx, () => home, { command: () => 'lark-cli.exe', environment: () => ({}), run })
  return { home, make, children, run, prompt, cancel, createWorkspace, createSession, agent,
    changeOwner: () => { owner = 'ou_someone_else' }, cleanup: () => { expect(home.startsWith(join(tmpdir(), 'wanwei-feishu-channel-'))).toBe(true); rmSync(home, { recursive: true, force: true }) } }
}

it('accepts only bounded user text DMs in the pinned event format', () => {
  expect(parseFeishuMessage(JSON.stringify(event()))?.text).toBe('帮我整理项目资料')
  for (const overrides of [{ sender_type: 'bot' }, { chat_type: 'group' }, { message_type: 'image' }, { content: '' },
    { content: '汉'.repeat(7000) }, { message_id: '../../bad' }, { create_time: 'invalid' }]) {
    expect(parseFeishuMessage(JSON.stringify(event(overrides)))).toBeNull()
  }
})

it('waits for ready, executes one desktop task, replies to the original message and preserves deduplication across restarts', async () => {
  const f = fixture(); let channel = f.make()
  try {
    await channel.enable()
    expect(native.spawn.mock.calls[0]![1]).toEqual(['event', 'consume', 'im.message.receive_v1', '--as', 'bot'])
    expect(native.spawn.mock.calls[0]![2]).toMatchObject({ shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const line = Buffer.from(JSON.stringify(event()) + '\n')
    f.children[0]!.stdout.emit('data', line.subarray(0, line.length - 5))
    f.children[0]!.stdout.emit('data', line.subarray(line.length - 5))
    expect(f.prompt).not.toHaveBeenCalled()
    f.children[0]!.stderr.emit('data', Buffer.from('[event] ready event_key=im.message.receive_v1\n'))
    await vi.waitFor(() => { expect(f.run.mock.calls.some(([args]) => args[1] === '+messages-reply')).toBe(true) })
    expect(f.prompt).toHaveBeenCalledTimes(1)
    const reply = f.run.mock.calls.find(([args]) => args[1] === '+messages-reply')![0]
    expect(reply).toContain('om_first')
    expect(reply[reply.indexOf('--as') + 1]).toBe('bot')
    expect(JSON.parse(reply[reply.indexOf('--content') + 1]!)).toEqual({ text: '@literal-result.txt\n整理完成' })
    f.children[0]!.stdout.emit('data', line)
    f.children[0]!.stdout.emit('data', Buffer.from(JSON.stringify(event({ message_id: 'om_second' })) + '\n'))
    await vi.waitFor(() => { expect(f.prompt).toHaveBeenCalledTimes(2) })
    expect(f.createSession).toHaveBeenCalledTimes(1)
    await channel.dispose()
    channel = f.make(); await channel.restore()
    f.children[1]!.stderr.emit('data', Buffer.from('[event] ready event_key=im.message.receive_v1\n'))
    f.children[1]!.stdout.emit('data', line)
    await Promise.resolve()
    expect(f.prompt).toHaveBeenCalledTimes(2)
    expect((JSON.parse(readFileSync(join(f.home, 'feishu-assistant/channel.json'), 'utf8')) as { seen: string[] }).seen).toEqual(['om_first', 'om_second'])
    await channel.disable()
    expect(channel.snapshot()).toMatchObject({ enabled: false, state: 'stopped' })
    expect(f.children[1]!.stdin.end).toHaveBeenCalled()
  } finally { await channel.dispose(); f.cleanup() }
})

it('ignores other users, groups, bots and old messages and rejects changed account ownership before execution', async () => {
  const f = fixture(); const channel = f.make()
  try {
    await channel.enable()
    f.children[0]!.stderr.emit('data', Buffer.from('[event] ready event_key=im.message.receive_v1\n'))
    for (const override of [{ sender_id: 'ou_other' }, { chat_type: 'group' }, { sender_type: 'bot' }, { create_time: '1' }]) {
      f.children[0]!.stdout.emit('data', Buffer.from(JSON.stringify(event(override)) + '\n'))
    }
    expect(f.prompt).not.toHaveBeenCalled()
    f.changeOwner()
    f.children[0]!.stdout.emit('data', Buffer.from(JSON.stringify(event()) + '\n'))
    await vi.waitFor(() => { expect(channel.snapshot().error).not.toBeNull() })
    expect(f.prompt).not.toHaveBeenCalled()
    expect(f.run.mock.calls.some(([args]) => args[1] === '+messages-reply')).toBe(false)
  } finally { await channel.dispose(); f.cleanup() }
})

it('cancels an active desktop task when disabled and never sends a late reply', async () => {
  const f = fixture(); const channel = f.make()
  let finish!: () => void
  f.agent.whenIdle.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
  try {
    await channel.enable()
    f.children[0]!.stderr.emit('data', Buffer.from('[event] ready event_key=im.message.receive_v1\n'))
    f.children[0]!.stdout.emit('data', Buffer.from(JSON.stringify(event()) + '\n'))
    await vi.waitFor(() => { expect(f.agent.whenIdle).toHaveBeenCalled() })
    await channel.disable()
    expect(f.cancel).toHaveBeenCalledTimes(1)
    finish()
    expect(f.run.mock.calls.some(([args]) => args[1] === '+messages-reply')).toBe(false)
  } finally { await channel.dispose(); f.cleanup() }
})
