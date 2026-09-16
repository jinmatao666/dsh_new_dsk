import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const productRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(productRoot, '..', '..')
const runtimeRoot = resolve(productRoot, 'src-tauri', 'resources', 'runtime')
const appRoot = resolve(runtimeRoot, 'app')
const nodeTarget = join(runtimeRoot, process.platform === 'win32' ? 'node.exe' : 'node')

assertDescendant(runtimeRoot, appRoot)
if (Number(process.versions.node.split('.')[0]) < 22) {
  throw new Error(`Wanwei desktop runtime requires Node 22+, got ${process.version}`)
}
if (existsSync(appRoot)) rmSync(appRoot, { recursive: true, force: true })
mkdirSync(runtimeRoot, { recursive: true })

run('corepack', [
  'pnpm',
  '--ignore-scripts',
  '--config.ignore-scripts=true',
  '--config.auto-install-peers=false',
  '--config.confirmModulesPurge=false',
  '--config.node-linker=hoisted',
  '--filter',
  'dsh-python-runtime-closure',
  'deploy',
  '--legacy',
  '--prod',
  appRoot,
])

// The dependency-only Python deploy root carries repository documentation and
// build metadata that the desktop Node runtime never reads. Keep the staged
// resource tree executable-only so docs gates and installers do not absorb it.
for (const file of [
  'README.md',
  'README.zh.md',
  'README.i18n.yaml',
  'hatch_build.py',
  'pyproject.toml',
  'platforms.json',
]) {
  rmSync(join(appRoot, file), { force: true })
}
rmSync(join(appRoot, 'src'), { recursive: true, force: true })

copyFileSync(process.execPath, nodeTarget)
if (process.platform !== 'win32') chmodSync(nodeTarget, 0o755)
prepareServerConfig()
restoreWorkspaceClosure([
  join(repositoryRoot, 'python', 'sdk-runtime', 'package.json'),
  join(repositoryRoot, 'apps', 'cli', 'package.json'),
  join(repositoryRoot, 'packages', 'bundle', 'base', 'package.json'),
  join(repositoryRoot, 'packages', 'bundle', 'web-app', 'package.json'),
  join(repositoryRoot, 'packages', 'bundle', 'wanwei-desktop', 'package.json'),
])
materializeLinks(join(appRoot, 'node_modules'))

const cli = join(appRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const productPatch = join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-wanwei-desktop', 'cordis.patch.yml')
const webIndex = join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html')
for (const required of [cli, productPatch, webIndex]) {
  if (!existsSync(required)) throw new Error(`Desktop runtime is missing ${relative(appRoot, required)}`)
}

const preflightHome = join(runtimeRoot, '.preflight-home')
if (existsSync(preflightHome)) rmSync(preflightHome, { recursive: true, force: true })
mkdirSync(preflightHome, { recursive: true })
try {
  const result = spawnSync(nodeTarget, [cli, '--profile', 'wanwei-desktop', '--dump-default-config'], {
    cwd: appRoot,
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: preflightHome },
  })
  if (result.status !== 0 || !result.stdout.includes("name: '@deepseek-ai/dsh-host-webserver'")) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n')
    throw new Error(`Staged Wanwei profile preflight failed:\n${detail}`)
  }
} finally {
  rmSync(preflightHome, { recursive: true, force: true })
}

process.stdout.write(`Wanwei desktop runtime staged at ${runtimeRoot}\n`)

function prepareServerConfig() {
  const configuredUrl = process.env.DSH_DESKTOP_SERVER_URL?.trim() ?? ''
  const configSource = process.env.DSH_DESKTOP_SERVER_CONFIG?.trim() ?? ''
  if (configuredUrl === '' && configSource === '') {
    if (process.env.GITHUB_ACTIONS === 'true') {
      throw new Error('GitHub Actions installer build requires DSH_DESKTOP_SERVER_URL or DSH_DESKTOP_SERVER_CONFIG')
    }
    return
  }

  const config = configuredUrl === ''
    ? JSON.parse(readFileSync(configSource, 'utf8'))
    : { oneApiUrl: configuredUrl, defaultModel: process.env.DSH_DEFAULT_MODEL ?? '' }
  if (typeof config.oneApiUrl !== 'string' || config.oneApiUrl.trim() === '') {
    throw new Error('Desktop server config requires a non-empty oneApiUrl')
  }
  const url = new URL(config.oneApiUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Desktop OneAPI URL must use http or https')
  }
  config.oneApiUrl = config.oneApiUrl.trim()
  config.installId = process.env.DSH_DESKTOP_INSTALL_ID?.trim() || randomUUID()
  writeFileSync(
    join(productRoot, 'src-tauri', 'resources', 'server.json'),
    `${JSON.stringify(config, null, 2)}\n`,
  )
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`)
}

function assertDescendant(parent, child) {
  const prefix = parent.endsWith(sep) ? parent : `${parent}${sep}`
  if (!child.startsWith(prefix)) throw new Error(`Refusing unsafe runtime target ${child}`)
}

function restoreWorkspaceClosure(entryManifests) {
  const workspace = discoverWorkspacePackages()
  const pending = [...entryManifests]
  const restored = new Set()
  for (let index = 0; index < pending.length; index++) {
    const manifestPath = pending[index]
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (typeof manifest.name === 'string' && workspace.has(manifest.name)) {
      if (restored.has(manifest.name)) continue
      restored.add(manifest.name)
      const source = workspace.get(manifest.name)
      const destination = join(appRoot, 'node_modules', manifest.name)
      rmSync(destination, { recursive: true, force: true })
      mkdirSync(dirname(destination), { recursive: true })
      copyTreeWithoutDependencies(source, destination)
    }
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
    }
    for (const dependency of Object.keys(dependencies)) {
      const source = workspace.get(dependency)
      if (source !== undefined && !restored.has(dependency)) {
        pending.push(join(source, 'package.json'))
      }
    }
  }
}

function discoverWorkspacePackages() {
  const packages = new Map()
  const roots = ['apps', 'packages', 'vendor', 'native'].map(name => join(repositoryRoot, name))
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'lib', 'dist', 'target', 'resources', 'gen'].includes(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(path)
      } else if (entry.name === 'package.json') {
        const manifest = JSON.parse(readFileSync(path, 'utf8'))
        if (typeof manifest.name === 'string') packages.set(manifest.name, dirname(path))
      }
    }
  }
  for (const root of roots) if (existsSync(root)) visit(root)
  return packages
}

function materializeLinks(directory) {
  for (;;) {
    const linked = findFirstLink(directory)
    if (linked === undefined) return
    const parts = relative(directory, linked).split(sep)
    const binIndex = parts.lastIndexOf('.bin')
    if (binIndex >= 0) {
      rmSync(join(directory, ...parts.slice(0, binIndex + 1)), { recursive: true, force: true })
      continue
    }
    const source = realpathSync(linked)
    rmSync(linked, { recursive: true, force: true })
    mkdirSync(dirname(linked), { recursive: true })
    copyTreeWithoutDependencies(source, linked)
  }
}

function findFirstLink(directory) {
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

function copyTreeWithoutDependencies(source, destination) {
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const sourcePath = join(source, entry.name)
    const targetPath = join(destination, entry.name)
    if (entry.isSymbolicLink()) {
      const resolved = realpathSync(sourcePath)
      if (lstatSync(resolved).isDirectory()) copyTreeWithoutDependencies(resolved, targetPath)
      else copyFileSync(resolved, targetPath)
    } else if (entry.isDirectory()) {
      copyTreeWithoutDependencies(sourcePath, targetPath)
    } else {
      copyFileSync(sourcePath, targetPath)
    }
  }
}
