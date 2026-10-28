/** Owner-only Feishu robot DM channel; credentials remain in the official CLI. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'

/** Public channel state, excluding account identifiers and credentials. */
export interface FeishuBridgeStatus {
  enabled: boolean
  state: 'stopped' | 'connecting' | 'ready' | 'error'
  error: string | null
}
interface Identity { appId: string; openId: string }
interface Saved extends Identity { enabled: boolean; since: number; seen: string[] }
interface Message { messageId: string; chatId: string; senderId: string; text: string; created: number }
interface Cli {
  command: () => string | undefined
  environment: () => NodeJS.ProcessEnv
  run: (args: readonly string[], signal: AbortSignal, cwd?: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

/** Validate the flattened event shape exported by the pinned CLI.
 * @param raw - One event stream record.
 * @returns Owner-verifiable text DM, or null for unsupported messages.
 */
export function parseFeishuMessage(raw: string): Message | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>
    if (v.type !== 'im.message.receive_v1' || v.sender_type !== 'user' || v.chat_type !== 'p2p' || v.message_type !== 'text') return null
    if (typeof v.message_id !== 'string' || !/^om_[a-zA-Z0-9_-]{1,160}$/.test(v.message_id)
      || typeof v.chat_id !== 'string' || !/^oc_[a-zA-Z0-9_-]{1,160}$/.test(v.chat_id)
      || typeof v.sender_id !== 'string' || !/^ou_[a-zA-Z0-9_-]{1,160}$/.test(v.sender_id)
      || typeof v.content !== 'string' || !v.content.trim() || Buffer.byteLength(v.content) > 20000) return null
    const created = Number(v.create_time)
    if (!Number.isFinite(created) || created <= 0) return null
    return { messageId: v.message_id, chatId: v.chat_id, senderId: v.sender_id, text: v.content.trim(), created }
  } catch { return null }
}

/** Bind a product-owned receive loop to its connector fiber.
 * @param ctx - Normal desktop workspace, session, and permission services.
 * @param home - Product home, resolved only when the channel is used.
 * @param cli - Official CLI execution operations owned by the connector.
 * @returns Channel controls; enabling is explicit and survives application restarts.
 */
export function createFeishuChannel(ctx: Context, home: () => string, cli: Cli) {
  let saved: Saved | undefined
  let state: FeishuBridgeStatus['state'] = 'stopped'
  let error: string | null = null
  let abort: AbortController | undefined
  let child: ChildProcessWithoutNullStreams | undefined
  let closed: Promise<void> = Promise.resolve()
  let queue: Promise<void> = Promise.resolve()
  let queued = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  let attempt = 0
  let disposed = false
  let startup: Promise<void> | undefined
  let controls: Promise<void> = Promise.resolve()
  const lifetime = new AbortController()
  const change = (operation: () => Promise<void>) => {
    const next = controls.then(operation)
    controls = next.catch(() => {})
    return next
  }
  const path = () => join(home(), 'feishu-assistant', 'channel.json')
  const persist = () => {
    const target = path()
    mkdirSync(dirname(target), { recursive: true })
    const temporary = `${target}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(saved), { mode: 0o600 })
    renameSync(temporary, target)
  }
  const identity = async (signal: AbortSignal): Promise<Identity> => {
    const result = await cli.run(['auth', 'status', '--json'], signal)
    const body = JSON.parse(result.stdout) as { appId?: unknown; data?: { appId?: unknown; identities?: unknown }; identities?: unknown }
    const data = body.data ?? body
    const user = (data.identities as { user?: { available?: unknown; status?: unknown; openId?: unknown } } | undefined)?.user
    if (result.exitCode !== 0 || user?.available !== true || !['ready', 'needs_refresh'].includes(String(user.status))
      || typeof data.appId !== 'string' || typeof user.openId !== 'string' || !/^ou_[a-zA-Z0-9_-]+$/.test(user.openId)) {
      throw new Error('请先完成飞书个人授权，再开启双向任务。')
    }
    return { appId: data.appId, openId: user.openId }
  }
  const verifyOwner = async (signal: AbortSignal) => {
    const current = await identity(signal)
    if (current.appId !== saved?.appId || current.openId !== saved.openId) throw new Error('飞书账号或应用已变化，请重新开启双向任务。')
  }
  const runTask = async (message: Message, signal: AbortSignal) => {
    signal.throwIfAborted()
    const owner = saved
    if (!owner?.enabled) throw new Error('飞书双向任务已关闭。')
    const cwd = join(home(), 'feishu-workspace', digest(`${owner.appId}:${owner.openId}:${message.chatId}`))
    mkdirSync(cwd, { recursive: true })
    const workspace = await ctx.workspaceRegistry.create(cwd, '飞书助理')
    const archived = new Set(ctx.workspaceRegistry.archivedSessionIds)
    let sessionId: SessionId | undefined
    for (const id of workspace.sessionIds) {
      if (archived.has(id)) continue
      const resolved = await ctx.sessionController.resolveAgent(id)
      if ('agent' in resolved) { sessionId = id; break }
      if (resolved.error.code !== 'session-not-found') throw new Error(resolved.error.message)
    }
    if (!sessionId) {
      const created = await ctx.sessionController.create({ workspaceId: workspace.id })
      sessionId = created.sessionId
      await ctx.sessionController.rename({ sessionId, title: '飞书助理' })
    }
    const resolved = await ctx.sessionController.resolveAgent(sessionId)
    if ('error' in resolved) throw new Error(resolved.error.message)
    const agent = resolved.agent
    const before = agent.session.events.length
    ctx.permissionPresets.set(agent.session, 'workspace-write')
    const cancel = () => { ctx.sessionController.cancel({ sessionId }) }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      signal.throwIfAborted()
      await ctx.sessionController.prompt({ sessionId, requestId: randomUUID() as SessionRequestId, mode: 'queue',
        content: [{ type: 'text', text: message.text }], clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }, signal)
      await new Promise<void>((resolve, reject) => {
        const stopped = () => { reject(new Error('飞书任务已停止')) }
        signal.addEventListener('abort', stopped, { once: true })
        if (signal.aborted) stopped()
        void agent.whenIdle().then(resolve, reject).finally(() => { signal.removeEventListener('abort', stopped) })
      })
      signal.throwIfAborted()
      await ctx.sessions.flush(agent.session)
      const events = agent.session.events.slice(before)
      const end = events.findLast(event => event.type === 'turn/end')
      if (end?.type !== 'turn/end' || end.data.reason.kind !== 'completed') throw new Error('桌面任务未完成，请在桌面查看会话。')
      const reply = events.findLast(event => event.type === 'assistant/message')
      return reply?.type === 'assistant/message'
        ? reply.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim() || '任务已完成。'
        : '任务已完成。'
    } finally { signal.removeEventListener('abort', cancel) }
  }
  const handle = async (message: Message, signal: AbortSignal) => {
    await verifyOwner(signal)
    let text: string
    try { text = await runTask(message, signal) }
    catch (failure) {
      signal.throwIfAborted()
      text = `桌面任务执行失败，请在桌面查看“飞书助理”会话。${failure instanceof Error ? ` ${failure.message}` : ''}`
    }
    signal.throwIfAborted()
    await verifyOwner(signal)
    // JSON --content prevents model output beginning with @ or - from becoming
    // an instruction to the CLI to read a local file or stdin.
    let replyText = text.slice(0, 6000)
    while (Buffer.byteLength(JSON.stringify({ text: replyText })) > 20000) {
      replyText = replyText.slice(0, Math.floor(replyText.length * .75))
    }
    const content = JSON.stringify({ text: replyText })
    const result = await cli.run(['im', '+messages-reply', '--message-id', message.messageId, '--msg-type', 'text',
      '--content', content, '--as', 'bot', '--idempotency-key', digest(message.messageId).slice(0, 48), '--json'], signal)
    if (result.exitCode !== 0) throw new Error('任务已执行，但飞书回传失败。请检查机器人的发送消息权限，并在桌面查看结果。')
    const body = JSON.parse(result.stdout) as { ok?: boolean }
    if (body.ok !== true) throw new Error('飞书未确认接收任务结果，请在桌面查看结果。')
    if (state === 'ready') error = null
  }
  const start = async () => {
    if (disposed || !saved?.enabled || child || abort) return
    const controller = new AbortController()
    abort = controller
    state = 'connecting'; error = null
    try {
      await verifyOwner(controller.signal)
      controller.signal.throwIfAborted()
      const command = cli.command()
      if (!command) throw new Error('未找到随包飞书 CLI，请使用完整安装包。')
      const process = spawn(command, ['event', 'consume', 'im.message.receive_v1', '--as', 'bot'], {
        windowsHide: true, shell: false, env: cli.environment(), stdio: ['pipe', 'pipe', 'pipe'],
      })
      child = process
      let stdout = ''; let stderr = ''
      const decoder = new StringDecoder('utf8')
      const startupTimer = setTimeout(() => {
        error = '消息接收连接超时，请检查飞书机器人长连接和事件订阅配置。'
        state = 'error'; process.stdin.end()
      }, 45000)
      const drain = () => {
        if (state !== 'ready' || controller.signal.aborted || !saved?.enabled) return
        let newline: number
        while ((newline = stdout.indexOf('\n')) >= 0) {
          const line = stdout.slice(0, newline); stdout = stdout.slice(newline + 1)
          const message = parseFeishuMessage(line)
          if (!message || message.senderId !== saved.openId || message.created < saved.since
            || saved.seen.includes(message.messageId)) continue
          if (queued >= 16) { error = '飞书任务队列已满，请稍后重新发送。'; continue }
          saved.seen = [...saved.seen.slice(-1023), message.messageId]
          try { persist() } catch { error = '无法保存飞书消息处理记录，已停止接收。'; state = 'error'; process.stdin.end(); break }
          queued++
          queue = queue.then(() => handle(message, controller.signal)).catch(() => {
            if (!controller.signal.aborted) error = '飞书任务或结果回传失败，请在桌面查看会话及机器人权限。'
          }).finally(() => { queued-- })
        }
      }
      process.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-16384)
        if (state === 'connecting' && stderr.includes('[event] ready event_key=im.message.receive_v1')) {
          clearTimeout(startupTimer); state = 'ready'; error = null; attempt = 0
          drain()
        }
      })
      process.stdout.on('data', (chunk: Buffer) => {
        stdout += decoder.write(chunk)
        if (Buffer.byteLength(stdout) > 1024 * 1024) {
          error = '飞书消息事件过大，已停止接收。'; state = 'error'; process.stdin.end(); return
        }
        drain()
      })
      closed = new Promise<void>((resolve) => {
        process.once('error', () => { error = '无法启动飞书消息接收进程。'; state = 'error' })
        process.once('close', (code) => {
          clearTimeout(startupTimer)
          if (child === process) child = undefined
          if (abort === controller) abort = undefined
          const intentional = controller.signal.aborted
          controller.abort()
          if (!intentional && !disposed && saved?.enabled) {
            state = 'error'
            error ??= code === 3
              ? '机器人缺少接收权限，请在飞书开放平台开启机器人并订阅接收消息事件。'
              : '飞书消息连接已断开，正在重连；请检查机器人长连接和事件订阅。'
            if (code !== 3) retry = setTimeout(() => { retry = undefined; void start() },
              Math.min(30000, 2000 * 2 ** Math.min(attempt++, 4)))
          }
          resolve()
        })
      })
    } catch (failure) {
      if (!controller.signal.aborted) { state = 'error'; error = failure instanceof Error ? failure.message : '飞书消息连接失败。' }
      if (abort === controller) abort = undefined
    }
  }
  const stop = async () => {
    if (retry) { clearTimeout(retry); retry = undefined }
    abort?.abort()
    const process = child
    if (process) {
      process.stdin.end()
      const timer = setTimeout(() => { process.kill() }, 3000)
      try { await closed } finally { clearTimeout(timer) }
    }
    await startup
    await queue
    child = undefined; abort = undefined; state = 'stopped'
  }
  return {
    snapshot(): FeishuBridgeStatus { return { enabled: saved?.enabled === true, state, error } },
    async restore() {
      if (disposed || saved) return
      try {
        if (!existsSync(path())) return
        const raw = JSON.parse(readFileSync(path(), 'utf8')) as Saved
        if (typeof raw.enabled !== 'boolean' || typeof raw.appId !== 'string' || typeof raw.openId !== 'string'
          || !Number.isFinite(raw.since) || !Array.isArray(raw.seen)) throw new Error('飞书双向任务配置无效，请重新开启。')
        saved = { ...raw, seen: raw.seen.filter(id => typeof id === 'string' && /^om_[a-zA-Z0-9_-]+$/.test(id)).slice(-1024) }
        startup = start(); await startup
      } catch (failure) { state = 'error'; error = failure instanceof Error ? failure.message : '飞书双向任务恢复失败。' }
    },
    enable() { return change(async () => {
      if (disposed) throw new Error('飞书连接器已关闭。')
      await stop()
      const current = await identity(lifetime.signal)
      lifetime.signal.throwIfAborted()
      const same = saved?.appId === current.appId && saved.openId === current.openId
      saved = { ...current, enabled: true, since: Date.now(), seen: same && saved ? saved.seen : [] }
      persist(); startup = start(); await startup
    }) },
    async resume() {
      if (saved?.enabled && !child && !abort && !retry) { startup = start(); await startup }
    },
    pause() { return change(stop) },
    disable() { return change(async () => {
      if (saved) { saved.enabled = false; persist() }
      await stop(); error = null
    }) },
    async dispose() { disposed = true; lifetime.abort(); abort?.abort(); await controls; await stop() },
  }
}
