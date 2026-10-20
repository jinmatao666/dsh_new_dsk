/**
 * Stage official `wecomcli-*` Agent Skills under
 * `products/wanwei-desktop/assets/wecom-skills` for Tauri `dev`.
 * Release builds still stage the same tree into the runtime via prepare-runtime.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const productRoot = resolve(import.meta.dirname, '..')
const skillsDest = join(productRoot, 'assets', 'wecom-skills')
const sharedSkill = join(skillsDest, 'wecomcli-shared', 'SKILL.md')

if (existsSync(sharedSkill)) {
  process.stdout.write(`WeCom skills already staged: ${skillsDest}\n`)
  process.exit(0)
}

const tmp = join(productRoot, '.wecom-skills-stage')
if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })
const archive = join(tmp, 'wecom-cli.tar.gz')

process.stdout.write('Downloading WeCom skills for desktop development…\n')
const download = spawnSync(
  process.execPath,
  ['--input-type=module', '--eval', `
import { writeFileSync } from 'node:fs';
const response = await fetch('https://codeload.github.com/WecomTeam/wecom-cli/tar.gz/refs/heads/main');
if (!response.ok) throw new Error('HTTP ' + response.status);
writeFileSync(${JSON.stringify(archive)}, Buffer.from(await response.arrayBuffer()));
`],
  { cwd: productRoot, encoding: 'utf8' },
)
if (download.status !== 0) {
  rmSync(tmp, { recursive: true, force: true })
  throw new Error(`Failed to download WeCom skills:\n${download.stderr || download.stdout}`)
}

const extract = spawnSync('tar', ['-xzf', archive, '-C', tmp], { encoding: 'utf8' })
if (extract.status !== 0) {
  rmSync(tmp, { recursive: true, force: true })
  throw new Error(`Failed to extract WeCom skills:\n${extract.stderr || extract.stdout}`)
}

const extracted = readdirSync(tmp)
  .map(name => join(tmp, name))
  .find(path => existsSync(join(path, 'skills', 'wecomcli-shared', 'SKILL.md')))
if (extracted === undefined) {
  rmSync(tmp, { recursive: true, force: true })
  throw new Error('WeCom skills archive is missing wecomcli-shared')
}

if (existsSync(skillsDest)) rmSync(skillsDest, { recursive: true, force: true })
mkdirSync(skillsDest, { recursive: true })
const sourceSkills = join(extracted, 'skills')
for (const name of readdirSync(sourceSkills)) {
  if (!name.startsWith('wecomcli-')) continue
  cpSync(join(sourceSkills, name), join(skillsDest, name), { recursive: true })
}
rmSync(tmp, { recursive: true, force: true })

if (!existsSync(sharedSkill)) {
  throw new Error(`WeCom skills staging failed (${sharedSkill})`)
}
// Touch a marker so local tooling can detect a fresh stage without scanning.
writeFileSync(join(skillsDest, '.staged'), `${new Date().toISOString()}\n`)
process.stdout.write(`WeCom skills staged: ${skillsDest}\n`)
