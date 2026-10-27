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

/** Public status never includes CLI credentials or device codes. */
export interface FeishuStatus {
  installed: boolean
  authed: boolean
  authorizing: boolean
  authorizationUrl: string | null
  qrDataUrl: string | null
  error: string | null
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
      if (error && (typeof error.code !== 'number' || error.killed)) reject(error)
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

/**
 * Read only non-secret error classification from CLI JSON; never expose raw auth output.
 * @param raw - Captured stdout or stderr.
 * @returns Validated upstream error classification, or undefined for non-JSON output.
 */
export function parseFeishuError(raw: string): { type: string; subtype: string } | undefined {
  const start = [...raw.matchAll(/\{\s*"ok"\s*:\s*false/g)].at(-1)?.index
  try {
    const value = JSON.parse(start === undefined ? raw : raw.slice(start)) as { error?: { type?: unknown; subtype?: unknown } }
    const { type, subtype } = value.error ?? {}
    if (typeof type === 'string' && typeof subtype === 'string'
      && /^[a-z_-]{1,64}$/.test(type) && /^[a-z_-]{1,64}$/.test(subtype)) return { type, subtype }
  } catch { /* Non-JSON progress output has no structured error classification. */ }
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
  const lifetime = new AbortController()
  const status = async (): Promise<FeishuStatus> => {
    const revision = authRevision
    const command = resolveLarkCommand()
    const authorized = !flight && !!command
      && parseFeishuAuthenticated((await runLark(['auth', 'status', '--json'], lifetime.signal)).stdout)
    const authed = authorized && revision === authRevision && !flight
    if (authed && command) prepareFeishuSkills(command)
    return { installed: !!command, authed, authorizing: flight !== undefined,
      authorizationUrl, qrDataUrl, error: failure }
  }
  const authorize = (operation: 'configure' | 'login') => {
    if (flight) return
    authRevision++
    authorizationUrl = null; qrDataUrl = null; failure = null
    const command = resolveLarkCommand()
    if (!command) throw new Error('未找到随包飞书 CLI，请使用完整安装包')
    const runStep = (args: string[]) => new Promise<void>((resolve, reject) => {
      authorizationUrl = null; qrDataUrl = null
      const child = spawn(command, args, { windowsHide: true, shell: false, env: cliEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'], signal: lifetime.signal })
      let output = ''
      const collect = (chunk: Buffer) => {
        output = (output + chunk.toString('utf8')).slice(-65536)
        const url = parseFeishuAuthorizationUrl(output)
        if (url && authorizationUrl !== url) {
          authorizationUrl = url
          const current = authorizationUrl
          void QRCode.toDataURL(current).then((value) => { if (authorizationUrl === current) qrDataUrl = value })
            .catch(() => { /* The original authorization link remains usable. */ })
        }
      }
      child.stdout.on('data', collect); child.stderr.on('data', collect)
      const timer = setTimeout(() => { failure = '飞书授权超时，请重试'; child.kill() }, 300000)
      child.once('error', reject)
      child.once('close', (code) => {
        clearTimeout(timer)
        if (code !== 0) {
          const error = parseFeishuError(output)
          const message = error?.subtype === 'not_configured' ? '飞书应用尚未配置，请先完成应用配置'
            : error ? `飞书授权失败（${error.type}/${error.subtype}），请检查网络、应用权限或重试`
              : `飞书授权进程退出（${code ?? 'signal'}），请重试连接`
          reject(new Error(failure ?? message))
        }
        else resolve()
      })
    })
    flight = (async () => {
      if (operation === 'configure') await runStep(['config', 'init', '--new'])
      else {
        const probe = await runLark(['auth', 'status', '--json'], lifetime.signal)
        const error = parseFeishuError(probe.stdout) ?? parseFeishuError(probe.stderr)
        if (error?.subtype === 'not_configured') await runStep(['config', 'init', '--new'])
        await runStep(['auth', 'login', '--recommend', '--json'])
      }
    })().catch((error: unknown) => { failure = error instanceof Error ? error.message : String(error) })
      .finally(() => { flight = undefined; authorizationUrl = null; qrDataUrl = null })
  }
  ctx.effect(() => ctx.connection.rpc.handle('/wanwei-feishu', async (operation) => {
    try {
      if (operation === 'configure' || operation === 'login') authorize(operation)
      else if (operation === 'disconnect') {
        if (flight) throw new Error('请先完成或等待当前授权结束')
        authRevision++
        flight = runLark(['auth', 'logout', '--json'], lifetime.signal).then((result) => {
          if (result.exitCode !== 0) throw new Error('飞书解绑失败，请重试')
          removeFeishuSkills(resolveProductDshHome())
        })
        try { await flight } finally { flight = undefined }
      } else if (operation !== 'status') throw new Error('未知飞书操作')
      return { ok: true as const, value: await status() }
    } catch (error) { return { ok: false as const, error: { code: 'INTERNAL' as const,
      message: error instanceof Error ? error.message : String(error), details: {} } } }
  }))
  ctx.effect(() => async () => { lifetime.abort(); await flight })
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'feishu_cli',
    description: 'Read lark-shared and the relevant installed lark-* business skill first. '
      + 'Use official lark-cli with the Feishu connector login. First inspect service --help; '
      + 'pass argv after lark-cli. Use --as user for personal resources. Login, config and credential commands '
      + 'belong to the connector page. Confirm recipient and intent before writes; never bypass high-risk confirmation. '
      + 'Example: ["calendar", "+agenda", "--as", "user"].',
    parameters: { args: { type: 'array', items: { type: 'string' }, required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (args.args.length === 0 || ['auth', 'config', 'update', 'install'].includes(args.args[0] ?? '')) {
        throw new Error('授权、凭据和配置操作请在飞书连接器中完成')
      }
      if (!(await status()).authed) throw new Error('请先在连接器页面完成飞书授权')
      const result = await runLark(args.args, exec.signal, exec.agent?.session.header.cwd)
      return JSON.stringify(result)
    },
  })))
}
