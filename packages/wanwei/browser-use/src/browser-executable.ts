/** Resolve an installed Chromium-family browser without downloading browser binaries. @module */
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'

/** Known install locations in Chrome-before-Edge order.
 * @param platform - Host operating system.
 * @param env - Host installation and PATH variables.
 * @param home - User home for macOS user applications.
 * @returns Candidate absolute executable paths, without duplicates.
 */
export function browserCandidates(platform: string, env: NodeJS.ProcessEnv, home: string): string[] {
  if (platform === 'win32') {
    const roots = [env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA]
      .filter((root): root is string => root !== undefined && root.length > 0)
    return [...new Set(['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe']
      .flatMap(relative => roots.map(root => join(root, relative))))]
  }
  if (platform === 'darwin') {
    return ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      .flatMap(relative => ['/Applications', join(home, 'Applications')].map(root => join(root, relative)))
  }
  const roots = (env.PATH ?? '').split(delimiter).filter(root => isAbsolute(root))
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable']
    .flatMap(name => roots.map(root => join(root, name)))
}

/** Find a runnable installed browser; explicit invalid paths never silently fall back.
 * @param explicit - Optional custom absolute executable path.
 * @returns Browser path, or undefined when no supported installation is found.
 * @throws If an explicit path is not an accessible executable file.
 */
export async function resolveBrowserExecutable(explicit?: string): Promise<string | undefined> {
  const runnable = async (path: string) => {
    if (!isAbsolute(path)) return false
    try {
      if (!(await stat(path)).isFile()) return false
      await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
      return true
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) return false
      throw error
    }
  }
  if (explicit !== undefined) {
    if (!(await runnable(explicit))) throw new Error(`配置的浏览器路径不可用：${explicit}。请指定已安装的 Chrome、Edge 或兼容 Chromium 浏览器的完整可执行文件路径。`)
    return explicit
  }
  for (const path of browserCandidates(process.platform, process.env, homedir())) {
    if (await runnable(path)) return path
  }
  return undefined
}

/** User/model feedback for an unavailable local browser. */
export const BROWSER_UNAVAILABLE = '未找到可用的本机 Chrome 或 Edge，浏览器任务无法开始。请安装浏览器，或请管理员配置已有浏览器的可执行文件路径。不要自动下载浏览器，也不要改用命令行或脚本绕过浏览器助手。'

/** Guidance stays in logged prompt assembly rather than fabricated conversation messages. */
export const BROWSER_GUIDANCE = '浏览器操作请使用浏览器助手工具。浏览器由程序选择本机已安装的 Chrome、Edge 或配置的兼容浏览器；不要自行安装或下载浏览器，不要通过 PowerShell、Bash、CDP 脚本绕过浏览器助手。若工具报告浏览器未找到或启动失败，请用中文说明原因并停止该浏览器任务，等待用户处理；不得声称网页已打开或操作已完成。遇到验证码请暂停并让用户手动处理。'

/** Detect browser startup errors, not ordinary page navigation or selector failures.
 * @param text - Browser tool output.
 * @returns Whether startup failed and requires user intervention.
 */
export function browserStartupFailure(text: string): boolean {
  return new RegExp(
    "Browser [\\s\\S]{0,100} is not installed|Executable doesn't exist|browserType\\.launch:"
    + '|Failed to launch[\\s\\S]{0,40}browser|spawn [^\\n]{0,250}(?:ENOENT|EACCES)',
    'iu',
  ).test(text)
}
