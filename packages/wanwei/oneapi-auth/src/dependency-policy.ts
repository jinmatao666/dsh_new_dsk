/** Intranet dependency failure feedback; downloads are not blocked by environment mode. */

/** Guidance added only while the server-confirmed environment is intranet. */
export const INTRANET_DEPENDENCY_GUIDANCE = '当前为纯内网模式，但这不代表实际网络不可达。脚本执行和依赖下载可以正常尝试，下载成功就继续任务；优先使用已有依赖、离线包或内网依赖源。若依赖获取失败，依据工具原始输出说明原因，不得仅因内网模式就断言断网；缺少模块、依赖源未找到包、连接失败和权限错误必须区分。不要盲目重试、擅自更换依赖源或修补包管理器；环境准备失败时先简短报告，不要把用户任务变成反复环境修复。只有必需依赖无法获取且没有可用替代方案时才停止依赖它的后续步骤。'
  + '失败回复保留“⚠ 所需依赖下载失败”（仅依赖未安装则用“⚠ 所需依赖未安装”），正文明确写出“当前为纯内网模式”及“任务暂时无法继续”，并用一两句话说明实际失败原因。依赖名称只从本次命令和失败日志中读取；无法确认名称时写“所需依赖”，不要沿用其他任务的依赖名称。仅有未找到包或版本的报错时，不得断言源已响应或网络不可达。不要输出处理建议、联系管理员、换源或离线安装方案，不展开大段原始报错。不要虚构失败原因或任务成功，不列出排查流水账，不把临时测试脚本列为正式产物，也不要删除用户已有文件。'

/** Distinct dependency failures; missing modules do not establish a network failure. */
export type DependencyFailure = 'missing' | 'download' | 'unavailable'

/** Stable feedback appended to the original failed tool output. */
export const DEPENDENCY_FEEDBACK: Record<DependencyFailure, string> = {
  missing: '当前为纯内网模式，工具报告所需依赖未安装；这不代表下载失败或网络不可达。请检查已有依赖，必要时允许尝试安装。若必需依赖最终无法获取，停止依赖它的步骤，按内网依赖指引简短输出“⚠ 所需依赖未安装”，明确说明当前为纯内网模式、任务暂时无法继续和实际原因。依赖名称从本次命令和失败日志读取，无法确认时写“所需依赖”。不要输出处理建议或展开大段原始报错，不要反复修复环境或将临时脚本作为正式产物。',
  download: '当前为纯内网模式，工具报告依赖下载连接失败。请依据原始输出说明实际原因，不要仅因内网模式断言整台电脑断网。若必需依赖无法获取，停止依赖它的步骤，按内网依赖指引简短输出“⚠ 所需依赖下载失败”，明确说明当前为纯内网模式、任务暂时无法继续和失败原因。依赖名称从本次命令和失败日志读取，无法确认时写“所需依赖”。不要输出处理建议或展开大段原始报错，不要盲目重试、擅自换源或声称任务成功，不把临时脚本作为正式产物。',
  unavailable: '当前为纯内网模式，工具报告依赖源未找到所需包或版本；仅凭此错误不能断定源已响应或网络不可达。若必需依赖无法获取，停止依赖它的步骤，按内网依赖指引简短输出“⚠ 所需依赖下载失败”，明确说明当前为纯内网模式、任务暂时无法继续和原始输出能够确认的原因。依赖名称从本次命令和失败日志读取，无法确认时写“所需依赖”。不要输出处理建议或展开大段原始报错，不要盲目重试、擅自换源或声称任务成功，不把临时脚本作为正式产物。',
}

/** Classify dependency diagnostics without treating permissions or syntax errors as networking.
 * @param text - Original tool output.
 * @returns Failure category, or undefined when no recognizable dependency failure is present.
 */
export function dependencyFailure(text: string): DependencyFailure | undefined {
  // 已恢复成功的镜像尝试不再触发失败提示；仍检查成功标记后其他命令的报错。
  const recovered = text.lastIndexOf('[wanwei-pip] result: success')
  if (recovered !== -1) text = text.slice(recovered + '[wanwei-pip] result: success'.length)
  const manager = /(?:pip|npm|pnpm|yarn|conda|uv|package|dependency|pypi|registry|Looking in indexes)/iu
  // Python 的 DLL 查找错误含 “dependencies”和 “_load_library”，并非网络请求失败。
  const nativeLibrary = /(?:FileNotFoundError|OSError|ImportError):[^\n]*(?:\.dll|\.so\b|\.dylib|DLL load failed)/iu
  if (nativeLibrary.test(text) || /ImportError: DLL load failed/iu.test(text)) {
    return 'missing'
  }
  const connection = new RegExp(
    '(?:ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|Failed to establish a new connection'
    + '|Network is unreachable|Could not resolve host|Connection refused|ConnectionError|ConnectTimeout'
    + '|ReadTimeout|ProxyError|SSLError|CERTIFICATE_VERIFY_FAILED|NameResolutionError|Max retries exceeded)',
    'iu',
  )
  if (manager.test(text) && connection.test(text)) return 'download'
  if (/(?:Could not find a version that satisfies the requirement|No matching distribution found|npm (?:ERR!|error) (?:code )?E404|No matching version found|ERR_PNPM_NO_MATCHING_VERSION|PackagesNotFoundError)/iu.test(text)) return 'unavailable'
  if (/(?:ModuleNotFoundError|No module named|Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND)/iu.test(text)) return 'missing'
  return undefined
}
