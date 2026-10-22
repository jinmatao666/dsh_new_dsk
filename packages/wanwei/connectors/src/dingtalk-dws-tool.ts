/**
 * Model-facing `dingtalk_dws` tool. Session shells run under the DSH file
 * sandbox, where `dws` cannot open the lock file in its `~/.dws` state
 * directory and reports a logged-in user as signed out. This tool runs the
 * product-bundled `dws` from the Host process with the Host environment, so
 * commands see the same login the DingTalk connector shows. The tool spawns
 * argv directly without a shell; `dws` itself can still write local files
 * that a command names (for example an export path) outside the sandbox.
 */
import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { TerminalCallView, TerminalResultView } from '@deepseek-ai/dsh-tools'

/** Tool name the dws-cli skill overlay tells the model to call. */
export const DINGTALK_DWS_TOOL = 'dingtalk_dws'

/** `dws auth` subcommands owned by the connector page: login, unbind, and credential transfer. */
const CONNECTOR_OWNED_AUTH = new Set(['login', 'logout', 'reset', 'exchange', 'export', 'import', 'migrate-keychain'])

/** One finished `dws` process. */
export interface DwsToolResult {
  /** Process exit code; null when `dws` ended by signal. */
  exitCode: number | null
  stdout: string
  stderr: string
}

/**
 * Reject argv the tool must not run.
 * @param args - arguments after `dws`.
 * @returns nothing when argv is allowed.
 */
export function validateDwsToolArgs(args: readonly string[]): void {
  if (args.length === 0) throw new Error('args 不能为空，例如 ["auth", "status", "--format", "json"]')
  if (args[0] === 'auth' && args[1] !== undefined && CONNECTOR_OWNED_AUTH.has(args[1])) {
    throw new Error(`dws auth ${args[1]} 由钉钉连接器负责。需要重新授权或解绑时，请用户在连接器页面操作。`)
  }
}

/**
 * Run one `dws` process to completion.
 * @param command - absolute `dws` executable or npm shim.
 * @param args - arguments after `dws`.
 * @param cwd - working directory; undefined inherits the Host cwd.
 * @param signal - kills the process when aborted.
 * @returns exit code and captured output.
 */
export function runDwsTool(command: string, args: readonly string[], cwd: string | undefined, signal: AbortSignal): Promise<DwsToolResult> {
  // npm `.cmd` shims need a shell on Windows; the native `dws.exe` does not.
  const shell = process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(command)
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell,
      windowsHide: true,
      env: process.env,
      ...cwd !== undefined ? { cwd } : {},
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    const abort = (): void => { child.kill() }
    signal.addEventListener('abort', abort, { once: true })
    child.once('error', (error) => {
      signal.removeEventListener('abort', abort)
      reject(error)
    })
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort)
      resolve({ exitCode: code, stdout, stderr })
    })
  })
}

function renderDwsResult(result: DwsToolResult): string {
  const parts = [result.stdout.replace(/\n+$/, '')]
  if (result.stderr.trim() !== '') parts.push(`[stderr]\n${result.stderr.replace(/\n+$/, '')}`)
  if (result.exitCode !== 0) parts.push(`[exit code: ${String(result.exitCode)}]`)
  return parts.filter(part => part !== '').join('\n')
}

/**
 * Register `dingtalk_dws`.
 * @param ctx - Host context with the tool registry.
 * @param resolveCommand - returns the `dws` executable, or undefined when none is installed; called per execution.
 * @returns nothing; disposing the plugin fiber unregisters the tool.
 */
export function registerDingTalkDwsTool(ctx: Context, resolveCommand: () => string | undefined): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: DINGTALK_DWS_TOOL,
    description: 'Run one DingTalk `dws` CLI command as the user logged in through the DingTalk connector. '
      + 'Use this for every `dws ...` command from the dws-cli skill; do not run `dws` through pwsh or bash, '
      + 'where the file sandbox hides the login and dws reports 未登录. '
      + 'Pass the arguments after `dws` as an array, for example ["chat", "+dm", "--to", "张三", "--content", "你好", "--yes", "--format", "json"]. '
      + 'Login and unbind (auth login/logout/reset) belong to the connector page and are rejected.',
    parameters: {
      args: { type: 'array', items: { type: 'string' }, required: true, description: 'Arguments after `dws`, one array element per argument.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
          stdout: { type: 'string', required: true },
          stderr: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderDwsResult(value) }],
    },
    async execute(args, exec): Promise<DwsToolResult> {
      validateDwsToolArgs(args.args)
      const command = resolveCommand()
      if (command === undefined) throw new Error('未找到随包 dws。请使用完整桌面安装包。')
      return runDwsTool(command, args.args, exec.agent?.session.header.cwd, exec.signal)
    },
    presentCall(args): TerminalCallView {
      return { card: 'terminal', title: `dws ${args.args.join(' ')}` }
    },
    presentResult(args, result): TerminalResultView {
      const text = result.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map(block => block.text)
        .join('')
      return { card: 'terminal', title: `dws ${args.args.join(' ')}`, output: text }
    },
  })), 'wanwei-connectors: dingtalk_dws')
}
