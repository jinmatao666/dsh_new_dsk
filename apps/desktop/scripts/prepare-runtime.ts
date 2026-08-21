/** Stage a self-contained Node + built DSH runtime for Tauri resources. */

import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
// The CLI is intentionally thin and its profiles load plugin packages through
// peer dependencies. Deploying the CLI alone drops those peers, which only
// fails after an installed desktop app tries to boot. The reviewed SDK runtime
// manifest is DSH's canonical, closed production dependency graph; extend it
// with the desktop bundle and deploy that graph instead.
//
// `--legacy` is required for a flat, link-free tree that Tauri can package on
// Windows. Lifecycle scripts stay disabled inside the production copy.
run('pnpm', [
  '--ignore-scripts',
  '--config.ignore-scripts=true',
  '--config.auto-install-peers=false',
  '--config.confirmModulesPurge=false',
  '--config.node-linker=hoisted',
  '--filter',
  'dsh-jsonrpc-agent-pkg',
  'deploy',
  '--legacy',
  '--prod',
  appDir,
])

restoreLegacyHoists()
materializeStagedLinks()

// Deploy the complete CLI closure. The CLI explicitly depends on the desktop
// bundle, so the staged app contains every executable and plugin dependency.
const cliDir = join(root, 'apps', 'cli')
copyFileSync(join(cliDir, 'package.json'), join(appDir, 'package.json'))
cpSync(join(cliDir, 'lib'), join(appDir, 'lib'), { recursive: true })
cpSync(join(cliDir, 'config'), join(appDir, 'config'), { recursive: true })

// Tauri/NSIS only needs executable JavaScript and package metadata. Some
// third-party packages ship very deep declaration/source-map trees which can
// exceed Windows NSIS path limits even though Node never reads them.
pruneRuntimeTypeArtifacts(appDir)

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

/** Restore direct dependencies that pnpm's legacy deploy hoists beside the staging directory. */
function restoreLegacyHoists(): void {
  const manifest = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  // Legacy deploy hoists peer-specialized workspace packages next to the
  // deploy manifest, not at the monorepo root.
  const sourceNodeModules = join(root, 'python', 'sdk-runtime', 'node_modules')
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    const destination = join(appDir, 'node_modules', dependency)
    if (existsSync(destination)) continue
    const source = join(sourceNodeModules, dependency)
    if (!existsSync(source)) {
      throw new Error(`Desktop runtime dependency is missing from deploy and source: ${dependency}`)
    }
    copyPackage(source, destination)
  }
}

/** Replace every workspace link with ordinary files before Tauri walks its resources. */
function materializeStagedLinks(): void {
  const nodeModules = join(appDir, 'node_modules')
  for (;;) {
    const linked = findFirstLink(nodeModules)
    if (linked === undefined) return
    const relative = linked.slice(nodeModules.length + 1).split(/[/\\\\]/)
    const binIndex = relative.lastIndexOf('.bin')
    if (binIndex >= 0) {
      rmSync(join(nodeModules, ...relative.slice(0, binIndex + 1)), { recursive: true, force: true })
      continue
    }
    copyPackage(realpathSync(linked), linked)
  }
}

function findFirstLink(directory: string): string | undefined {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (lstatSync(path).isSymbolicLink()) return path
    if (entry.isDirectory()) {
      const nested = findFirstLink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

function copyPackage(source: string, destination: string): void {
  const nestedNodeModules = join(source, 'node_modules')
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: (path: string) => path !== nestedNodeModules && !path.startsWith(`${nestedNodeModules}\\`),
  })
}

function pruneRuntimeTypeArtifacts(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      // The deployed runtime is hoisted. Nested package-local node_modules
      // trees only duplicate dependencies and create extremely long NSIS
      // source paths on Windows.
      if (entry.name === 'node_modules' && directory !== join(appDir, 'node_modules')) {
        rmSync(path, { recursive: true, force: true })
        continue
      }
      pruneRuntimeTypeArtifacts(path)
      continue
    }
    if (/\.(?:d\.(?:ts|mts|cts)|map)$/i.test(entry.name)) rmSync(path, { force: true })
  }
}
