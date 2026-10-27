/** Export the pinned CLI's embedded official skills without a runtime download. */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Export all embedded Markdown, retaining sibling skill links and reference paths.
 * @param {string} command - Verified native lark-cli executable.
 * @param {string} version - Version of that executable.
 * @returns {string} Exported skill directory.
 */
export function ensureLarkSkills(command, version) {
  const root = join(dirname(command), 'skills')
  const manifest = join(root, 'manifest.json')
  if (existsSync(manifest)) {
    const saved = JSON.parse(readFileSync(manifest, 'utf8'))
    if (saved.version === version && saved.files?.length > 0
      && saved.files.every(file => existsSync(join(root, file)))) return root
  }
  const run = args => execFileSync(command, args, {
    encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
  })
  const catalog = JSON.parse(run(['skills', 'list']))
  if (catalog.ok !== true || !Array.isArray(catalog.skills) || catalog.skills.length === 0) {
    throw new Error('Feishu CLI returned an empty skill catalog')
  }
  const names = catalog.skills.map(skill => skill.name)
  if (!names.every(name => /^lark-[a-z0-9-]+$/.test(name))) throw new Error('Invalid Feishu skill name')
  const files = []
  const visit = (path) => {
    const result = JSON.parse(run(['skills', 'list', path]))
    if (result.ok !== true || !Array.isArray(result.entries)) throw new Error(`Cannot export ${path}`)
    for (const entry of result.entries) {
      if (typeof entry.path !== 'string' || !entry.path.startsWith(`${path}/`)
        || entry.path.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\') || part.includes(':'))) {
        throw new Error('Unsafe Feishu embedded skill path')
      }
      if (entry.is_dir) visit(entry.path)
      else if (entry.path.endsWith('.md')) {
        const target = join(root, entry.path)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, run(['skills', 'read', entry.path]))
        files.push(entry.path)
      }
    }
  }
  names.forEach(visit)
  if (!names.every(name => files.includes(`${name}/SKILL.md`))) throw new Error('Incomplete Feishu skill export')
  writeFileSync(manifest, JSON.stringify({ version, names, files }, null, 2) + '\n')
  return root
}
