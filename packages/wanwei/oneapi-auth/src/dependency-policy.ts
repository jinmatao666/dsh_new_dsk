/** Product-level feedback for dependency downloads; not an OS network sandbox. */
import { internalLink } from './network-contract.ts'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Stable tool feedback shown to the user and returned to the model. */
export const DEPENDENCY_BLOCKED = '当前为纯内网环境，无法在线下载所需依赖。请先检查依赖是否已安装，或使用离线安装包、内网依赖源；若必需依赖仍无法获取，任务暂时无法继续，请联系管理员安装依赖。不要反复尝试外网下载，也不要将未完成的任务描述为成功。'

/** Model guidance applies only while the server-confirmed environment is intranet. */
export const INTRANET_DEPENDENCY_GUIDANCE = '当前为纯内网环境。脚本编辑、执行及本地处理仍可用。使用依赖前先检查是否已安装；优先使用本地离线安装包或可访问的内网依赖源，离线安装应明确使用离线选项。不要尝试从互联网下载依赖。若工具报告依赖缺失或下载失败，不要盲目重试、更换外网镜像或规避限制；检查离线替代方案。只有必需依赖无法获取且没有替代方案时，才用中文说明任务暂时无法推进、缺少什么依赖，以及需要管理员安装或提供离线包。说明已完成的部分，不得声称任务全部成功。'

/** Extract known shell tool input without inspecting unrelated tools or file edits.
 * @param name - Tool identifier.
 * @param args - Tool input fields.
 * @returns Shell input, or undefined for unrelated tools.
 */
export function shellInput(name: string, args: Record<string, unknown>): string | undefined {
  if (name === 'bash' && typeof args.command === 'string') return args.command
  if (name === 'terminal_send' && typeof args.text === 'string') return args.text
  return undefined
}

/** Identify direct package-manager downloads; nested/custom scripts rely on result feedback.
 * @param command - Shell input to classify.
 * @param origins - Administrator-owned internal service origins.
 * @param workdir - Working directory used to locate package-manager configuration.
 * @returns Whether a direct public dependency download is detected.
 */
export function requiresPublicDependencies(command: string, origins: readonly string[], workdir?: string): boolean {
  // Keep quoted text together: editing a script containing "pip install" is not execution.
  const tokens = command.match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s;|&]+|[;\n|&]+/gu) ?? []
  let currentSegment: string[] = []
  const segments: string[][] = [currentSegment]
  for (const token of tokens) {
    if (/^[;\n|&]+$/u.test(token)) {
      currentSegment = []
      segments.push(currentSegment)
    } else currentSegment.push(token.replace(/^(?:"(.*)"|'(.*)')$/su, '$1$2'))
  }
  return segments.some((segment) => {
    const env = { ...process.env }
    while (segment[0] === 'env' || segment[0] === 'sudo') segment.shift()
    while (segment[0]?.includes('=') && /^[A-Za-z_][\w]*=/u.test(segment[0])) {
      const token = segment[0]
      segment.shift()
      const at = token.indexOf('=')
      env[token.slice(0, at)] = token.slice(at + 1)
    }
    while (segment[0] === 'env' || segment[0] === 'sudo') segment.shift()
    let manager = segment.shift()?.replace(/^.*[/\\]/u, '').replace(/\.(?:exe|cmd)$/iu, '').toLowerCase()
    if (manager === 'python' || manager === 'python3' || manager === 'py') {
      if (segment[0] !== '-m' || !/^pip(?:3)?$/u.test(segment[1] ?? '')) return false
      segment.splice(0, 2); manager = 'pip'
    }
    if (manager === 'uv' && segment[0] === 'pip') { segment.shift(); manager = 'pip' }
    const pip = /^pip(?:3)?$/u.test(manager ?? '')
    const node = ['npm', 'pnpm', 'yarn'].includes(manager ?? '')
    const conda = manager === 'conda'
    if (!pip && !node && !conda) return false
    if (!segment.some(value => ['install', 'download', 'add', 'ci', 'update', 'upgrade', 'create'].includes(value))) return false
    const publicUrl = segment.some((value) => {
      const urls = value.match(/https?:\/\/[^\s'"<>]+/gu) ?? []
      return urls.some(url => !internalLink(url, origins))
    })
    if (publicUrl) return true
    if (segment.includes('--offline') || (pip && segment.includes('--no-index'))) return false
    const primary = pip ? ['--index-url', '-i'] : node ? ['--registry'] : ['--override-channels']
    const configured: string[] = []
    for (const [i, flag] of segment.entries()) {
      const next = segment[i + 1]
      for (const option of primary) {
        if (flag === option && next) configured.push(next)
        if (flag.startsWith(`${option}=`)) configured.push(flag.slice(option.length + 1))
      }
    }
    const mirror = pip ? env.PIP_INDEX_URL : node ? env.npm_config_registry ?? env.NPM_CONFIG_REGISTRY : undefined
    if (configured.length === 0 && mirror) configured.push(mirror)
    if (pip && env.PIP_EXTRA_INDEX_URL && !internalLink(env.PIP_EXTRA_INDEX_URL, origins)) return true
    if (configured.length > 0 && configured.every(url => internalLink(url, origins))) return false
    // Config files and shell variables cannot be resolved safely by this recognizer.
    // Let them execute and supply accurate feedback if the attempt fails.
    if (configured.some(url => url.includes('$') || url.includes('%'))) return false
    // Package config is authoritative and may hold internal mirrors. Do not
    // pretend to emulate package-manager precedence; let the manager resolve it.
    const configFiles = pip
      ? [env.PIP_CONFIG_FILE, join(homedir(), '.config/pip/pip.conf'), join(homedir(), '.pip/pip.conf'),
        env.APPDATA === undefined ? undefined : join(env.APPDATA, 'pip/pip.ini')]
      : node ? [env.npm_config_userconfig, join(homedir(), '.npmrc'),
        join(workdir ?? process.cwd(), '.npmrc'), join(workdir ?? process.cwd(), '.yarnrc.yml')]
        : [join(homedir(), '.condarc')]
    if (configFiles.some(path => path !== undefined && existsSync(path))) return false
    return true
  })
}

/** Recognize dependency failures without relabeling ordinary script errors as network failures.
 * @param text - Tool failure output.
 * @returns Whether the output identifies dependency resolution or download failure.
 */
export function dependencyFailure(text: string): boolean {
  const missing = /(?:ModuleNotFoundError|No module named|Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND)/iu
  const unavailable = /(?:Could not find a version that satisfies the requirement|No matching distribution found)/iu
  const network = new RegExp(
    String.raw`(?:pip|npm|pnpm|yarn|conda|package|dependency|pypi|registry)[\s\S]{0,400}`
    + '(?:ENOTFOUND|EAI_AGAIN|ETIMEDOUT|Failed to establish a new connection|Network is unreachable|Could not resolve host)',
    'iu',
  )
  return missing.test(text) || unavailable.test(text) || network.test(text)
}
