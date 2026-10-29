/** Official native lark-cli execution and connector-owned authorization. */
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import QRCode from 'qrcode'
import { resolveProductDshHome } from './dingtalk-dws.ts'
import { installFeishuSkills, removeFeishuSkills } from './feishu-skills.ts'
import { createFeishuChannel, type FeishuBridgeStatus } from './feishu-channel.ts'

/** Public status never includes CLI credentials or device codes. */
export interface FeishuStatus {
  installed: boolean
  authed: boolean
  authorizing: boolean
  authorizationUrl: string | null
  qrDataUrl: string | null
  error: string | null
  missingScopes: string[]
  authorizationStage: 'configure' | 'login' | null
  bridge: FeishuBridgeStatus
}

/** Locate only native executables; model arguments never pass through a shell.
 * @returns Staged product executable or an explicitly installed native CLI.
 */
export function resolveLarkCommand(): string | undefined {
  const binary = process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli'
  const roots = [process.env.DSH_APP_ROOT, process.env.DSH_NODE_BINARY && join(dirname(process.env.DSH_NODE_BINARY), 'app'),
    process.env.DSH_BUNDLE_ANCHORS && dirname(process.env.DSH_BUNDLE_ANCHORS), process.cwd()]
  let root = dirname(fileURLToPath(import.meta.url))
  for (let index = 0; index < 8; index++) {
    roots.push(join(root, 'products', 'wanwei-desktop'))
    root = dirname(root)
  }
  return [process.env.DSH_LARK_CLI, ...roots.filter((value): value is string => !!value)
    .map(value => join(value, 'assets', 'lark-1.0.98', binary)),
  ...(process.env.PATH ?? '').split(delimiter).map(value => join(value, binary))]
    .find((value): value is string => !!value && existsSync(value) && !/\.(cmd|bat|ps1)$/i.test(value))
}

function cliEnvironment(): NodeJS.ProcessEnv {
  return { ...Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD/i.test(key))),
  LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' }
}

/** Execute bounded native argv, preserving nonzero CLI output for the model.
 * @param args - Arguments after lark-cli.
 * @param signal - Caller cancellation; the process is terminated before settlement.
 * @param cwd - Session working directory.
 * @returns Captured output and native exit status.
 */
export function runLark(args: readonly string[], signal: AbortSignal, cwd?: string): Promise<{
  stdout: string
  stderr: string
  exitCode: number
}> {
  const command = resolveLarkCommand()
  if (!command) return Promise.reject(new Error('未找到随包飞书 CLI，请使用完整安装包'))
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { windowsHide: true, env: cliEnvironment(), signal,
      timeout: 60000, maxBuffer: 2 * 1024 * 1024, ...(cwd ? { cwd } : {}) }, (error, stdout, stderr) => {
      if (error && (typeof error.code !== 'number' || error.killed)) reject(error instanceof Error ? error : new Error(JSON.stringify(error)))
      else resolve({ stdout, stderr, exitCode: typeof error?.code === 'number' ? error.code : 0 })
    })
  })
}

/** Read the official user-identity status rather than trusting an exit-zero probe.
 * @param raw - JSON stdout from auth status.
 * @returns Whether a saved user identity is authorized.
 */
export function parseFeishuAuthenticated(raw: string): boolean {
  try {
    const envelope = JSON.parse(raw) as {
      ok?: boolean
      data?: { identities?: { user?: {
        available?: boolean
        status?: string
        tokenStatus?: string
      } } }
      identities?: { user?: {
        available?: boolean
        status?: string
        tokenStatus?: string
      } }
    }
    const user = (envelope.data ?? envelope).identities?.user
    return envelope.ok !== false && user?.available === true
      && (user.status === 'ready' || user.status === 'needs_refresh')
  } catch { return false }
}

// CLI progress is NDJSON on stdout and human-readable text on stderr. Never join
// the streams before decoding a final event, which may coexist with progress.
function jsonEvents(raw: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = []
  let start = -1; let depth = 0; let quoted = false; let escaped = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (start < 0) { if (ch === '{') { start = i; depth = 1 }; continue }
    if (quoted) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') quoted = false
    } else if (ch === '"') quoted = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) {
      try { events.push(JSON.parse(raw.slice(start, i + 1)) as Record<string, unknown>) } catch { /* Ignore non-JSON progress. */ }
      start = -1
    }
  }
  return events
}

/** Parse only safe scope names and completed-login events, never token payloads.
 * @param raw - One bounded CLI output stream.
 * @returns Completion flag and validated missing permission names.
 */
export function parseFeishuAuthorizationResult(raw: string): { completed: boolean; missingScopes: string[] } {
  let completed = false
  const missing = new Set<string>()
  for (const event of jsonEvents(raw)) {
    const error = event.error as { missing_scopes?: unknown } | undefined
    if (event.event === 'authorization_complete') completed = true
    const scopes = event.event === 'authorization_complete' || event.ok === false ? event.missing ?? error?.missing_scopes : undefined
    if (Array.isArray(scopes)) for (const scope of scopes) {
      if (typeof scope === 'string' && /^[a-z][a-z0-9_.:-]{0,199}$/.test(scope)) missing.add(scope)
    }
  }
  return { completed, missingScopes: [...missing] }
}

/** Read only non-secret CLI error classification.
 * @param raw - One captured stdout or stderr stream.
 * @returns Validated upstream error classification, or undefined.
 */
export function parseFeishuError(raw: string): { type: string; subtype: string } | undefined {
  for (const event of jsonEvents(raw).reverse()) {
    const error = event.error as { type?: unknown; subtype?: unknown } | undefined
    const { type, subtype } = error ?? {}
    if (typeof type === 'string' && typeof subtype === 'string'
      && /^[a-z_-]{1,64}$/.test(type) && /^[a-z_-]{1,64}$/.test(subtype)) return { type, subtype }
  }
  return undefined
}

/**
 * Read complete official verification URLs without changing their query or encoding.
 * @param output - Bounded accumulated CLI progress output.
 * @returns Latest complete authorization URL, excluding documentation links.
 */
export function parseFeishuAuthorizationUrl(output: string): string | undefined {
  const candidates: string[] = []
  for (const match of output.matchAll(/"(?:verification_url|verification_uri_complete|console_url)"\s*:\s*("(?:[^"\\]|\\.)*")/g)) {
    candidates.push(JSON.parse(match[1] ?? '""') as string)
  }
  for (const line of output.split(/\r?\n/).slice(0, -1)) {
    const value = line.trim()
    if (/^https:\/\/\S+$/.test(value)) candidates.push(value)
  }
  return candidates.reverse().find((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && !url.username && !url.password
        && (url.hostname.endsWith('.feishu.cn') || url.hostname.endsWith('.larksuite.com'))
    } catch { return false }
  })
}

/**
 * Prepare bundled business skills after a successful user-authorization probe.
 * @param command - Resolved native CLI whose sibling skills were staged at build time.
 */
export function prepareFeishuSkills(command: string): void {
  installFeishuSkills(resolveProductDshHome(), join(dirname(command), 'skills'))
}

/** Mount the Feishu RPC and guarded business tool; auth processes belong to this plugin fiber.
 * @param ctx - Host connection and tool registry.
 */
export function registerFeishu(ctx: Context): void {
  let flight: Promise<void> | undefined
  let authRevision = 0
  let authorizationUrl: string | null = null
  let qrDataUrl: string | null = null
  let failure: string | null = null
  let missingScopes: string[] = []
  let messageScopeRevision = -1
  let authorizationStage: 'configure' | 'login' | null = null
  const lifetime = new AbortController()
  const channel = createFeishuChannel(ctx, resolveProductDshHome, {
    command: resolveLarkCommand, environment: cliEnvironment, run: runLark,
  })
  const status = async (): Promise<FeishuStatus> => {
    const revision = authRevision
    const command = resolveLarkCommand()
    const authorized = !flight && !!command
      && parseFeishuAuthenticated((await runLark(['auth', 'status', '--json'], lifetime.signal)).stdout)
    const authed = authorized && revision === authRevision && !flight
    if (authed && command) {
      failure = null
      if (missingScopes.length > 0 || messageScopeRevision !== revision) {
        if (!missingScopes.includes('im:message.send_as_user')) missingScopes = [...missingScopes, 'im:message.send_as_user']
        const expected = missingScopes
        const check = await runLark(['auth', 'check', '--scope', expected.join(' '), '--json'], lifetime.signal)
        if (revision === authRevision && !flight && expected === missingScopes) {
          if (check.exitCode === 0) { missingScopes = []; messageScopeRevision = revision }
          else {
            const result = parseFeishuAuthorizationResult(check.stdout)
            if (result.missingScopes.length > 0) missingScopes = result.missingScopes
          }
        }
      }
      if (revision === authRevision && !flight) {
        prepareFeishuSkills(command)
        if (missingScopes.length === 0) {
          if (!channel.snapshot().enabled) await channel.enable()
          else await channel.resume()
        }
      }
    }
    return { installed: !!command, authed: authed && revision === authRevision && !flight, authorizing: flight !== undefined,
      authorizationUrl, qrDataUrl, error: failure, missingScopes: [...missingScopes], authorizationStage, bridge: channel.snapshot() }
  }
  const authorize = (operation: 'configure' | 'login' | 'authorize-messages') => {
    if (flight) return
    authRevision++
    if (operation === 'authorize-messages') missingScopes = [...new Set([...missingScopes, 'im:message.send_as_user'])]
    authorizationUrl = null; qrDataUrl = null; failure = null
    const command = resolveLarkCommand()
    if (!command) throw new Error('未找到随包飞书 CLI，请使用完整安装包')
    const runStep = (args: string[]) => new Promise<void>((resolve, reject) => {
      authorizationUrl = null; qrDataUrl = null
      authorizationStage = args[0] === 'config' ? 'configure' : 'login'
      const child = spawn(command, args, { windowsHide: true, shell: false, env: cliEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'], signal: lifetime.signal })
      let stdout = ''; let stderr = ''
      const collect = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
        if (stream === 'stdout') stdout = (stdout + chunk.toString('utf8')).slice(-65536)
        else stderr = (stderr + chunk.toString('utf8')).slice(-65536)
        const url = parseFeishuAuthorizationUrl(stream === 'stdout' ? stdout : stderr)
        if (url && authorizationUrl !== url) {
          authorizationUrl = url
          const current = authorizationUrl
          void QRCode.toDataURL(current).then((value) => { if (authorizationUrl === current) qrDataUrl = value })
            .catch(() => { /* The original authorization link remains usable. */ })
        }
      }
      child.stdout.on('data', (chunk: Buffer) => { collect('stdout', chunk) })
      child.stderr.on('data', (chunk: Buffer) => { collect('stderr', chunk) })
      const timer = setTimeout(() => { failure = '飞书授权超时，请重试'; child.kill() }, 300000)
      child.once('error', (error) => { clearTimeout(timer); reject(error) })
      child.once('close', (code) => {
        clearTimeout(timer)
        const result = parseFeishuAuthorizationResult(stdout)
        const scopes = [...new Set([...result.missingScopes, ...parseFeishuAuthorizationResult(stderr).missingScopes])]
        if (scopes.length > 0) missingScopes = scopes
        // Official CLI saves a valid identity, emits authorization_complete, then
        // exits 3 when only some requested scopes were granted. Probe the identity
        // through status() and expose missing permissions separately from failure.
        if (code === 3 && result.completed) { resolve(); return }
        if (code !== 0) {
          const error = parseFeishuError(stderr) ?? parseFeishuError(stdout)
          const message = error?.subtype === 'not_configured' ? '飞书应用尚未配置，请先完成应用配置'
            : error ? `飞书授权失败（${error.type}/${error.subtype}），请检查网络、应用权限或重试`
              : `飞书授权进程退出（${code ?? 'signal'}），请重试连接`
          reject(new Error(failure ?? message))
        }
        else resolve()
      })
    })
    flight = (async () => {
      {
        if (operation === 'configure') await runStep(['config', 'init', '--new'])
        const probe = await runLark(['auth', 'status', '--json'], lifetime.signal)
        const error = parseFeishuError(probe.stdout) ?? parseFeishuError(probe.stderr)
        if (operation !== 'configure' && error?.subtype === 'not_configured') await runStep(['config', 'init', '--new'])
        const scopes = operation === 'authorize-messages' ? ['im:message.send_as_user'] : missingScopes
        await runStep(scopes.length > 0
          ? ['auth', 'login', '--scope', scopes.join(' '), '--json']
          : ['auth', 'login', '--recommend', '--json'])
        if (missingScopes.length === 0) {
          const check = await runLark(['auth', 'check', '--scope', 'im:message.send_as_user', '--json'], lifetime.signal)
          if (check.exitCode !== 0) {
            missingScopes = ['im:message.send_as_user']
            await runStep(['auth', 'login', '--scope', 'im:message.send_as_user', '--json'])
          }
        }
      }
    })().catch((error: unknown) => { failure = error instanceof Error ? error.message : String(error) })
      .finally(() => {
        flight = undefined; authorizationUrl = null; qrDataUrl = null; authorizationStage = null
        if (!lifetime.signal.aborted && failure === null) {
          void status().catch((error: unknown) => { failure = error instanceof Error ? error.message : String(error) })
        }
      })
  }
  ctx.effect(() => ctx.connection.rpc.handle('/wanwei-feishu', async (operation) => {
    try {
      if (operation === 'configure' || operation === 'login' || operation === 'authorize-messages') {
        if (!flight) { await channel.pause(); authorize(operation) }
      } else if (operation === 'bridge-enable') {
        if (flight) throw new Error('请先完成飞书授权，再开启双向任务。')
        await channel.enable()
      } else if (operation === 'bridge-disable') await channel.disable()
      else if (operation === 'disconnect') {
        if (flight) throw new Error('请先完成或等待当前授权结束')
        await channel.disable()
        authRevision++
        flight = runLark(['auth', 'logout', '--json'], lifetime.signal).then((result) => {
          if (result.exitCode !== 0) throw new Error('飞书解绑失败，请重试')
          missingScopes = []; failure = null
          removeFeishuSkills(resolveProductDshHome())
        })
        try { await flight } finally { flight = undefined }
      } else if (operation !== 'status') throw new Error('未知飞书操作')
      return { ok: true as const, value: await status() }
    } catch (error) { return { ok: false as const, error: { code: 'INTERNAL' as const,
      message: error instanceof Error ? error.message : String(error), details: {} } } }
  }))
  ctx.effect(() => {
    void channel.restore().then(() => channel.enableIfUnconfigured()).catch(() => {})
    return async () => { lifetime.abort(); await channel.dispose(); await flight }
  })
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'feishu_cli',
    description: 'Read lark-shared and the relevant installed lark-* business skill first. '
      + 'Use official lark-cli with the Feishu connector login. First inspect service --help; '
      + 'pass argv after lark-cli. Use --as user for personal resources. Login, config and credential commands '
      + 'belong to the connector page. Confirm recipient and intent before writes; never bypass high-risk confirmation. '
      + 'On missing_scope, stop and direct the user to the Feishu connector supplementary authorization; do not retry the write. '
      + 'Example: ["calendar", "+agenda", "--as", "user"].',
    parameters: { args: { type: 'array', items: { type: 'string' }, required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (args.args.length === 0 || ['auth', 'config', 'update', 'install'].includes(args.args[0] ?? '')
        || (args.args[0] === 'event' && ['consume', 'stop'].includes(args.args[1] ?? ''))) {
        throw new Error('授权、凭据、消息监听和配置操作请在飞书连接器中完成')
      }
      if (!(await status()).authed) throw new Error('请先在连接器页面完成飞书授权')
      if (missingScopes.length > 0) throw new Error('飞书缺少业务权限，请在飞书连接器点击“补充授权”，完成后再执行。不要重复重试或在对话中运行登录命令。')
      const result = await runLark(args.args, exec.signal, exec.agent?.session.header.cwd)
      const scopes = [...new Set([...parseFeishuAuthorizationResult(result.stdout).missingScopes,
        ...parseFeishuAuthorizationResult(result.stderr).missingScopes])]
      if (result.exitCode !== 0 && scopes.length > 0) {
        missingScopes = [...new Set([...missingScopes, ...scopes])]
        return JSON.stringify({ ...result, connectorAction: '请在飞书连接器点击“补充授权”，完成后再执行；当前操作未完成，不要重复重试或通过终端登录。' })
      }
      return JSON.stringify(result)
    },
  })))
}
