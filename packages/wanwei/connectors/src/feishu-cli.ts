/** Official native lark-cli execution and connector-owned authorization. */
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import QRCode from 'qrcode'

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

/** Mount the Feishu RPC and guarded business tool; auth processes belong to this plugin fiber.
 * @param ctx - Host connection and tool registry.
 */
export function registerFeishu(ctx: Context): void {
  let flight: Promise<void> | undefined
  let authorizationUrl: string | null = null
  let qrDataUrl: string | null = null
  let failure: string | null = null
  const lifetime = new AbortController()
  const status = async (): Promise<FeishuStatus> => ({
    installed: resolveLarkCommand() !== undefined,
    authed: flight ? false : resolveLarkCommand() !== undefined
      && parseFeishuAuthenticated((await runLark(['auth', 'status', '--json'], lifetime.signal)).stdout),
    authorizing: flight !== undefined, authorizationUrl, qrDataUrl, error: failure,
  })
  const authorize = (args: string[]) => {
    if (flight) return
    authorizationUrl = null; qrDataUrl = null; failure = null
    const command = resolveLarkCommand()
    if (!command) throw new Error('未找到随包飞书 CLI，请使用完整安装包')
    flight = new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { windowsHide: true, shell: false, env: cliEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'], signal: lifetime.signal })
      let output = ''
      const collect = (chunk: Buffer) => {
        output = (output + chunk.toString('utf8')).slice(-65536)
        for (const match of output.matchAll(/https:\/\/[^\s"<>\x1b]+/g)) {
          try {
            const url = new URL(match[0])
            if (!(url.hostname.endsWith('.feishu.cn') || url.hostname.endsWith('.larksuite.com'))) continue
            if (authorizationUrl === url.href) continue
            authorizationUrl = url.href
            const current = authorizationUrl
            void QRCode.toDataURL(current).then((value) => { if (authorizationUrl === current) qrDataUrl = value })
              .catch(() => { /* The original authorization link remains usable. */ })
          } catch { /* A partial streamed URL is considered on the next chunk. */ }
        }
      }
      child.stdout.on('data', collect); child.stderr.on('data', collect)
      const timer = setTimeout(() => { failure = '飞书授权超时，请重试'; child.kill() }, 300000)
      child.once('error', reject)
      child.once('close', (code) => {
        clearTimeout(timer)
        if (code !== 0) reject(new Error(failure ?? '飞书授权未完成，请检查应用配置并重试'))
        else resolve()
      })
    }).catch((error: unknown) => { failure = error instanceof Error ? error.message : String(error) })
      .finally(() => { flight = undefined; authorizationUrl = null; qrDataUrl = null })
  }
  ctx.effect(() => ctx.connection.rpc.handle('/wanwei-feishu', async (operation) => {
    try {
      if (operation === 'configure') authorize(['config', 'init', '--new'])
      else if (operation === 'login') authorize(['auth', 'login', '--recommend'])
      else if (operation === 'disconnect') {
        if (flight) throw new Error('请先完成或等待当前授权结束')
        const result = await runLark(['auth', 'logout', '--json'], lifetime.signal)
        if (result.exitCode !== 0) throw new Error('飞书解绑失败，请重试')
      } else if (operation !== 'status') throw new Error('未知飞书操作')
      return { ok: true as const, value: await status() }
    } catch (error) { return { ok: false as const, error: { code: 'INTERNAL' as const,
      message: error instanceof Error ? error.message : String(error), details: {} } } }
  }))
  ctx.effect(() => async () => { lifetime.abort(); await flight })
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'feishu_cli',
    description: 'Use official lark-cli with the Feishu connector login. First inspect service --help; '
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
