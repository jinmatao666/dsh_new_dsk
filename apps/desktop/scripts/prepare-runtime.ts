/** Stage a self-contained Node + built DSH runtime for Tauri resources. */

import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const desktopDir = resolve(import.meta.dirname, '..')
const root = resolve(desktopDir, '..', '..')
const resources = join(desktopDir, 'src-tauri', 'resources', 'runtime')
const appDir = join(resources, 'app')
const configuredNode = process.env.DSH_NODE_BINARY
const nodeBinary = configuredNode === undefined ? process.execPath : resolve(configuredNode)
const stagedNode = join(resources, process.platform === 'win32' ? 'node.exe' : 'node')

if (!existsSync(nodeBinary)) throw new Error(`Node binary not found: ${nodeBinary}`)
if (Number(process.versions.node.split('.')[0]) < 22) {
  throw new Error(`DSH Desktop runtime requires Node 22+, got ${process.version}`)
}

const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`)
}

run('pnpm', ['run', 'build:official'])
if (existsSync(appDir)) rmSync(appDir, { recursive: true, force: true })
mkdirSync(dirname(appDir), { recursive: true })
// Tauri recursively walks bundled resources. pnpm's isolated linker creates
// directory junctions (including peer-dependency cycles) that make that walk
// recurse indefinitely on Windows. The desktop package directly declares the
// CLI and SDK runtime closure; modern deploy injects their built workspace
// packages, while the hoisted linker keeps the staged runtime self-contained
// and link-free.
// Lifecycle scripts stay disabled inside the production copy.
run('pnpm', [
  '--ignore-scripts',
  '--config.inject-workspace-packages=true',
  '--config.node-linker=hoisted',
  '--filter',
  '@deepseek-ai/dsh',
  'deploy',
  '--prod',
  appDir,
])

// Deploy the complete CLI closure. The CLI explicitly depends on the desktop
// bundle, so the staged app contains every executable and plugin dependency.
const cliDir = join(root, 'apps', 'cli')
copyFileSync(join(cliDir, 'package.json'), join(appDir, 'package.json'))
cpSync(join(cliDir, 'lib'), join(appDir, 'lib'), { recursive: true })
cpSync(join(cliDir, 'config'), join(appDir, 'config'), { recursive: true })

// The reviewed subprocess postinstall only restores executable mode on
// node-pty's prebuilt spawn helpers. Deploy skips lifecycle scripts, so apply
// that mode to both macOS architectures explicitly for cross-target builds.
for (const architecture of ['arm64', 'x64']) {
  const helper = join(appDir, 'node_modules', 'node-pty', 'prebuilds', `darwin-${architecture}`, 'spawn-helper')
  if (existsSync(helper)) chmodSync(helper, 0o755)
}
copyFileSync(nodeBinary, stagedNode)
if (process.platform !== 'win32') chmodSync(stagedNode, 0o755)

// Deploy follows package `files`; the built browser frontend is a runtime
// resource of dsh-web-app and is copied explicitly when the package manager
// does not retain it in the deployed closure.
const webDist = join(root, 'apps', 'web', 'dist')
const stagedDist = join(appDir, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist')
if (existsSync(webDist) && !existsSync(stagedDist)) cpSync(webDist, stagedDist, { recursive: true })

const configSource = process.env.DSH_DESKTOP_SERVER_CONFIG
const configuredUrl = process.env.DSH_DESKTOP_SERVER_URL
if (configuredUrl !== undefined && configuredUrl.trim() !== '') {
  const config = { oneApiUrl: configuredUrl.trim(), defaultModel: process.env.DSH_DEFAULT_MODEL ?? '' }
  JSON.parse(JSON.stringify(config))
  const target = join(desktopDir, 'src-tauri', 'resources', 'server.json')
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`)
} else if (configSource !== undefined) {
  JSON.parse(readFileSync(configSource, 'utf8')) as unknown
  copyFileSync(resolve(configSource), join(desktopDir, 'src-tauri', 'resources', 'server.json'))
}

console.log(`DSH Desktop runtime staged at ${resources}`)
