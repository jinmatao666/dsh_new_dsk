/** Product-scoped installation of the official skills exported from bundled lark-cli. */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { copyDirectoryTree } from './copy-tree.ts'

const OWNER = '.wanwei-feishu-skill'
const EXECUTION = `\n<!-- wanwei-feishu-tool -->
## 万维桌面端执行方式（优先于下方通用终端说明）

本技能及参考文档中的每条 \`lark-cli ...\` 命令，都通过 \`feishu_cli\` 工具执行，args 是可执行文件名之后的参数数组，不要通过 bash/pwsh 启动。例如 \`lark-cli calendar +agenda --as user\` 对应 \`{"args":["calendar","+agenda","--as","user"]}\`。

先读 lark-shared 和当前业务对应的官方 Skill/参考文档，再执行命令。个人资源使用 --as user。工具返回 stdout、stderr、exitCode；stdout 中的 JSON 信封仍按官方规则解析。配置应用、登录、退出、升级和安装由连接器页面管理，不执行这些命令，不读取或输出凭据。不支持的额外脚本或机器资源不要猜测或自动下载安装。

保留官方高风险确认规则：退出码 10 时停止并向用户展示操作和关键参数；取得明确同意后才能按官方 hint 重试。自动化无人确认时停止并报告，不自行追加确认参数。

`

function catalog(source: string): { version: string; names: string[] } {
  const value: unknown = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'))
  if (!value || typeof value !== 'object' || !('version' in value) || typeof value.version !== 'string'
    || !('names' in value) || !Array.isArray(value.names) || value.names.length === 0
    || !value.names.every((name: unknown) => typeof name === 'string' && /^lark-[a-z0-9-]+$/.test(name))) {
    throw new Error('随包飞书 Skills 清单无效，请使用完整安装包')
  }
  return { version: value.version, names: value.names }
}

/**
 * Install official Markdown and references under the product's own skills root.
 * Existing unrelated skills are never overwritten; source paths come only from the bundled CLI.
 * @param home - Product DSH home.
 * @param source - Bundled exported skills directory.
 */
export function installFeishuSkills(home: string, source: string): void {
  const { version, names } = catalog(source)
  const base = join(home, 'skills')
  for (const name of names) {
    if (!existsSync(join(source, name, 'SKILL.md'))) throw new Error(`随包飞书 Skill 不完整：${name}`)
    const dest = join(base, name)
    if (existsSync(dest) && (lstatSync(dest).isSymbolicLink() || !existsSync(join(dest, OWNER)))) {
      throw new Error(`飞书 Skill 目录已被其他技能占用：${name}`)
    }
  }
  for (const name of names) {
    const dest = join(base, name)
    if (existsSync(join(dest, 'SKILL.md')) && readFileSync(join(dest, OWNER), 'utf8') === version) continue
    copyDirectoryTree(join(source, name), dest)
    const path = join(dest, 'SKILL.md')
    const original = readFileSync(path, 'utf8')
    const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(original)
    if (!frontmatter) throw new Error(`飞书 Skill 缺少元信息：${name}`)
    writeFileSync(path, original.slice(0, frontmatter[0].length) + EXECUTION + original.slice(frontmatter[0].length))
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, OWNER), version)
  }
}

/**
 * Remove only connector-owned skill directories on explicit unbind.
 * @param home - Product DSH home.
 */
export function removeFeishuSkills(home: string): void {
  const base = join(home, 'skills')
  if (!existsSync(base)) return
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!/^lark-[a-z0-9-]+$/.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue
    const dest = join(base, entry.name)
    if (existsSync(join(dest, OWNER))) rmSync(dest, { recursive: true, force: true })
  }
}
