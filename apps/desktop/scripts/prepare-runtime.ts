/** Stage a self-contained Node + built DSH runtime for Tauri resources. */

import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const desktopDir = resolve(import.meta.dirname, '..')
const root = resolve(desktopDir, '..', '..')
const resources = join(desktopDir, 'src-tauri', 'resources', 'runtime')
const appDir = join(resources, 'app')
let workspacePackageMap: Map<string, string> | undefined
const runtimeDependencies = dependencyClosure([
  join(root, 'python', 'sdk-runtime', 'package.json'),
  join(root, 'apps', 'cli', 'package.json'),
  join(root, 'packages', 'bundle', 'base', 'package.json'),
  join(root, 'packages', 'bundle', 'web-app', 'package.json'),
  join(root, 'packages', 'bundle', 'desktop', 'package.json'),
])
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

restoreLegacyHoists(runtimeDependencies)
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
// Pruning can remove a package-local tree that legacy deploy used as the
// source of a direct workspace dependency. Restore the complete dependency
// closure of the shipped profile bundles and refuse to ship a partial sidecar.
restoreLegacyHoists(runtimeDependencies)
assertRuntimeDependencies(runtimeDependencies)
verifySidecarRuntime()

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

/** Read the runtime and peer dependencies declared by a package manifest. */
function dependencyNames(manifestPath: string): string[] {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    peerDependenciesMeta?: Record<string, { optional?: boolean }>
    optionalDependencies?: Record<string, string>
  }
  const peers = Object.keys(manifest.peerDependencies ?? {})
    .filter(name => manifest.peerDependenciesMeta?.[name]?.optional !== true)
  return [...new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...peers,
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ])].sort()
}

/** Read optional dependency names so unsupported platform packages can be skipped. */
function optionalDependencyNames(manifestPath: string): string[] {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    optionalDependencies?: Record<string, string>
  }
  return Object.keys(manifest.optionalDependencies ?? {})
}

/** Resolve the complete dependency closure of the shipped profile bundles. */
function dependencyClosure(manifests: readonly string[]): string[] {
  const dependencies = new Set<string>()
  const queue = [...manifests]
  for (let index = 0; index < queue.length; index++) {
    const manifestPath = queue[index]
    const optional = new Set(optionalDependencyNames(manifestPath))
    for (const dependency of dependencyNames(manifestPath)) {
      if (dependencies.has(dependency)) continue
      dependencies.add(dependency)
      const source = sourcePackageDirectory(dependency)
      if (source === undefined) {
        if (optional.has(dependency)) {
          dependencies.delete(dependency)
          continue
        }
        throw new Error(`Desktop runtime dependency is missing from source workspace: ${dependency}`)
      }
      queue.push(join(source, 'package.json'))
    }
  }
  return [...dependencies].sort()
}

/** Restore dependencies that pnpm's legacy deploy hoists beside the staging directory. */
function restoreLegacyHoists(dependencies: readonly string[]): void {
  for (const dependency of dependencies) {
    const destination = join(appDir, 'node_modules', dependency)
    if (existsSync(destination)) continue
    const source = sourcePackageDirectory(dependency)
    if (source === undefined) {
      throw new Error(`Desktop runtime dependency is missing from deploy and source: ${dependency}`)
    }
    copyPackage(source, destination)
  }
}

/** Locate a package from the deployed dependency tree or the workspace source. */
function sourcePackageDirectory(packageName: string): string | undefined {
  const candidates = [
    join(root, 'python', 'sdk-runtime', 'node_modules', packageName),
    join(root, 'node_modules', packageName),
  ]
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  const pnpmStore = join(root, 'node_modules', '.pnpm')
  if (existsSync(pnpmStore)) {
    for (const entry of readdirSync(pnpmStore, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidate = join(pnpmStore, entry.name, 'node_modules', packageName)
      if (existsSync(join(candidate, 'package.json'))) return candidate
    }
  }
  workspacePackageMap ??= discoverWorkspacePackages()
  return workspacePackageMap.get(packageName)
}

/** Build a package-name index without traversing generated or dependency trees. */
function discoverWorkspacePackages(): Map<string, string> {
  const packages = new Map<string, string>()
  const roots = [
    join(root, 'packages'),
    join(root, 'apps'),
    join(root, 'native'),
    join(root, 'vendor'),
    join(root, 'python'),
  ]
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'target'
        || entry.name === 'dist' || entry.name === 'lib' || entry.name === 'runtime') continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(path)
        continue
      }
      if (entry.name !== 'package.json') continue
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as { name?: unknown }
      if (typeof manifest.name === 'string') packages.set(manifest.name, dirname(path))
    }
  }
  for (const directory of roots) if (existsSync(directory)) visit(directory)
  return packages
}

/** Fail the release build rather than shipping a sidecar missing a declared runtime package. */
function assertRuntimeDependencies(dependencies: readonly string[]): void {
  const missing = dependencies.filter(dependency => !existsSync(join(appDir, 'node_modules', dependency)))
  if (missing.length > 0) {
    throw new Error(`Desktop runtime is missing required dependencies: ${missing.join(', ')}`)
  }
}

/** Load the staged desktop profile once so a broken import fails during CI, not after installation. */
function verifySidecarRuntime(): void {
  const result = spawnSync(nodeBinary, [join(appDir, 'lib', 'bin.js'), '--profile', 'desktop', '--dump-default-config'], {
    cwd: appDir,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr]
      .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
      .join('\n')
    throw new Error(`Desktop runtime preflight failed: ${detail || `exit status ${String(result.status)}`}`)
  }

  // The desktop profile loads plugins with native optional dependencies. A
  // production deploy can pass the CLI config check while still omitting the
  // platform package selected by sharp/koffi, which makes the installed app
  // exit before opening its window. Import the native entry points explicitly
  // while the staged tree is still in CI so that missing platform binaries are
  // reported as a build failure instead of a broken installer.
  const nativeResult = spawnSync(nodeBinary, [
    '--input-type=module',
    '--eval',
    "await import('sharp'); await import('koffi')",
  ], {
    cwd: appDir,
    encoding: 'utf8',
  })
  if (nativeResult.status === 0) return
  const detail = [result.stdout, result.stderr]
    .concat([nativeResult.stdout, nativeResult.stderr])
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join('\n')
  throw new Error(`Desktop native runtime preflight failed: ${detail || `exit status ${String(nativeResult.status)}`}`)
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
