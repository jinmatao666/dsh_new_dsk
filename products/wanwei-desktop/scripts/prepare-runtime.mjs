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
import { ensureProductProfile } from './product-profile.mjs'
import { pruneStagedRuntimeDevArtifacts, removeStagedEntry, shouldSkipStagedRuntimeEntry } from './runtime-files.mjs'

const productRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(productRoot, '..', '..')
const releaseVersion = process.env.DSH_RELEASE_VERSION?.trim() || '0.1.0'
if (!/^[0-9A-Za-z][0-9A-Za-z.-]*$/u.test(releaseVersion)) {
  throw new Error(`DSH_RELEASE_VERSION contains an unsupported runtime directory character: ${releaseVersion}`)
}
const resourcesRoot = resolve(productRoot, 'src-tauri', 'resources')
const runtimeRoot = resolve(resourcesRoot, `runtime-${releaseVersion}`)
const appRoot = resolve(runtimeRoot, 'app')
const nodeTarget = join(runtimeRoot, process.platform === 'win32' ? 'node.exe' : 'node')

assertDescendant(runtimeRoot, appRoot)
if (Number(process.versions.node.split('.')[0]) < 22) {
  throw new Error(`Wanwei desktop runtime requires Node 22+, got ${process.version}`)
}
for (const entry of readdirSync(resourcesRoot, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name === 'runtime') {
    for (const oldEntry of readdirSync(join(resourcesRoot, entry.name))) {
      if (oldEntry !== '.gitkeep') rmSync(join(resourcesRoot, entry.name, oldEntry), { recursive: true, force: true })
    }
  } else if (entry.isDirectory() && entry.name.startsWith('runtime-')) {
    rmSync(join(resourcesRoot, entry.name), { recursive: true, force: true })
  }
}
mkdirSync(runtimeRoot, { recursive: true })

run('corepack', [
  'pnpm',
  '--ignore-scripts',
  '--config.ignore-scripts=true',
  '--config.auto-install-peers=false',
  '--config.confirmModulesPurge=false',
  '--config.node-linker=hoisted',
  '--filter',
  '@wanwei/dsh-desktop-runtime-closure',
  'deploy',
  '--legacy',
  '--prod',
  appRoot,
])

// The dependency-only deploy roots carry repository documentation and
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
// Workspace restores copy full package trees; drop tests before the NSIS payload
// is built so Windows installers do not hit MAX_PATH on `*.host.spec.ts` paths.
pruneStagedRuntimeDevArtifacts(appRoot)
copyFileSync(join(productRoot, 'scripts', 'document-tool.mjs'), join(appRoot, 'document-tool.mjs'))
stageDingTalkRuntime(appRoot)
stageWeComRuntime(appRoot)

const cli = join(appRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const productPatch = join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-wanwei-desktop', 'cordis.patch.yml')
const webIndex = join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html')
for (const required of [cli, productPatch, webIndex]) {
  if (!existsSync(required)) throw new Error(`Desktop runtime is missing ${relative(appRoot, required)}`)
}

const preflightHome = join(runtimeRoot, '.preflight-home')
if (existsSync(preflightHome)) rmSync(preflightHome, { recursive: true, force: true })
mkdirSync(preflightHome, { recursive: true })
ensureProductProfile(preflightHome)
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
    env: {
      ...process.env,
      // `pnpm deploy --legacy` starts a nested production install. CLI config
      // is not forwarded to that process, so use npm's standard environment
      // form to keep repository lifecycle scripts disabled in the staged app.
      npm_config_ignore_scripts: 'true',
    },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`)
}

/**
 * Extract the native `dws` binary from `dingtalk-workspace-cli` assets.
 * `pnpm deploy` runs with lifecycle scripts disabled, so postinstall never
 * materializes `vendor/dws[.exe]`.
 * @param {string} appRoot - staged desktop app root.
 */
function stageDingTalkRuntime(appRoot) {
  const packageRoot = join(appRoot, 'node_modules', 'dingtalk-workspace-cli')
  if (!existsSync(join(packageRoot, 'package.json'))) {
    throw new Error('Desktop runtime is missing dingtalk-workspace-cli')
  }
  const platformArchive = {
    'darwin-x64': 'dws-darwin-amd64.tar.gz',
    'darwin-arm64': 'dws-darwin-arm64.tar.gz',
    'linux-x64': 'dws-linux-amd64.tar.gz',
    'linux-arm64': 'dws-linux-arm64.tar.gz',
    'win32-x64': 'dws-windows-amd64.zip',
    'win32-arm64': 'dws-windows-arm64.zip',
  }[`${process.platform}-${process.arch}`]
  if (platformArchive === undefined) {
    throw new Error(`DingTalk DWS is not published for ${process.platform}-${process.arch}`)
  }
  const archive = join(packageRoot, 'assets', platformArchive)
  if (!existsSync(archive)) {
    throw new Error(`Desktop runtime is missing DWS archive ${relative(appRoot, archive)}`)
  }
  const vendorDir = join(packageRoot, 'vendor')
  const binaryName = process.platform === 'win32' ? 'dws.exe' : 'dws'
  const binary = join(vendorDir, binaryName)
  const tmp = join(runtimeRoot, '.dws-bin-stage')
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  try {
    if (platformArchive.endsWith('.tar.gz')) {
      const extract = spawnSync('tar', ['-xzf', archive, '-C', tmp], { encoding: 'utf8' })
      if (extract.status !== 0) {
        throw new Error(`Failed to extract DWS archive:\n${extract.stderr || extract.stdout}`)
      }
    } else if (process.platform === 'win32') {
      const extract = spawnSync('tar', ['-xf', archive, '-C', tmp], { encoding: 'utf8' })
      if (extract.status !== 0) {
        throw new Error(`Failed to extract DWS archive:\n${extract.stderr || extract.stdout}`)
      }
    } else {
      const extract = spawnSync('unzip', ['-q', archive, '-d', tmp], { encoding: 'utf8' })
      if (extract.status !== 0) {
        throw new Error(`Failed to extract DWS archive:\n${extract.stderr || extract.stdout}`)
      }
    }
    const found = findFileNamed(tmp, binaryName)
    if (found === undefined) {
      throw new Error(`DWS binary ${binaryName} not found inside ${platformArchive}`)
    }
    if (existsSync(vendorDir)) rmSync(vendorDir, { recursive: true, force: true })
    mkdirSync(vendorDir, { recursive: true })
    copyFileSync(found, binary)
    if (process.platform !== 'win32') chmodSync(binary, 0o755)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  if (!existsSync(binary)) {
    throw new Error(`Desktop runtime is missing bundled DWS binary (${relative(appRoot, binary)})`)
  }
  // Stage dws-cli skill assets next to the binary so packaged Hosts resolve them via
  // DSH_NODE_BINARY → app/assets/dws-cli without relying on require.resolve.
  const skillSource = join(appRoot, 'node_modules', '@dingtalk-real-ai', 'dsh-dingtalk', 'assets', 'skills', 'dws-cli')
  if (!existsSync(join(skillSource, 'SKILL.md'))) {
    throw new Error(`Desktop runtime is missing dws-cli skill assets (${relative(appRoot, skillSource)})`)
  }
  const skillDest = join(appRoot, 'assets', 'dws-cli')
  if (existsSync(skillDest)) rmSync(skillDest, { recursive: true, force: true })
  mkdirSync(dirname(skillDest), { recursive: true })
  copyTreeWithoutDependencies(skillSource, skillDest)
  if (!existsSync(join(skillDest, 'SKILL.md'))) {
    throw new Error(`Desktop runtime failed to stage dws-cli skill (${relative(appRoot, skillDest)})`)
  }
}

/**
 * Recursively find a file by basename.
 * @param {string} root - directory to search.
 * @param {string} name - file name.
 * @returns {string | undefined} absolute path.
 */
function findFileNamed(root, name) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      const nested = findFileNamed(path, name)
      if (nested !== undefined) return nested
    } else if (entry.name === name) {
      return path
    }
  }
  return undefined
}

/**
 * Stage the WorkBuddy-style WeCom CLI binary + Agent Skills into the runtime app.
 * Users click「连接」without a separate `npm install -g @wecom/cli`.
 * @param {string} appRoot - staged desktop app root.
 */
function stageWeComRuntime(appRoot) {
  const platformPackage = {
    'darwin-arm64': '@wecom/cli-darwin-arm64',
    'darwin-x64': '@wecom/cli-darwin-x64',
    'linux-arm64': '@wecom/cli-linux-arm64',
    'linux-x64': '@wecom/cli-linux-x64',
    'win32-x64': '@wecom/cli-win32-x64',
  }[`${process.platform}-${process.arch}`]
  if (platformPackage === undefined) {
    throw new Error(`WeCom CLI is not published for ${process.platform}-${process.arch}`)
  }
  const binaryName = process.platform === 'win32' ? 'wecom-cli.exe' : 'wecom-cli'
  const binary = join(appRoot, 'node_modules', ...platformPackage.split('/'), 'bin', binaryName)
  if (!existsSync(binary)) {
    throw new Error(
      `Desktop runtime is missing bundled WeCom CLI (${relative(appRoot, binary)}). `
      + 'Ensure @wecom/cli optionalDependencies are installed for this platform.',
    )
  }
  const skillsDest = join(appRoot, 'assets', 'wecom-skills')
  if (existsSync(skillsDest)) rmSync(skillsDest, { recursive: true, force: true })
  mkdirSync(skillsDest, { recursive: true })
  const tmp = join(runtimeRoot, '.wecom-skills-stage')
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  const archive = join(tmp, 'wecom-cli.tar.gz')
  const download = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', `
import { writeFileSync } from 'node:fs';
const response = await fetch('https://codeload.github.com/WecomTeam/wecom-cli/tar.gz/refs/heads/main');
if (!response.ok) throw new Error('HTTP ' + response.status);
writeFileSync(${JSON.stringify(archive)}, Buffer.from(await response.arrayBuffer()));
`],
    { cwd: repositoryRoot, encoding: 'utf8' },
  )
  if (download.status !== 0) {
    throw new Error(`Failed to download WeCom skills for runtime staging:\n${download.stderr || download.stdout}`)
  }
  const extract = spawnSync('tar', ['-xzf', archive, '-C', tmp], { encoding: 'utf8' })
  if (extract.status !== 0) {
    throw new Error(`Failed to extract WeCom skills:\n${extract.stderr || extract.stdout}`)
  }
  const extracted = readdirSync(tmp)
    .map(name => join(tmp, name))
    .find(path => existsSync(join(path, 'skills', 'wecomcli-shared', 'SKILL.md')))
  if (extracted === undefined) {
    throw new Error('WeCom skills archive is missing wecomcli-shared')
  }
  const sourceSkills = join(extracted, 'skills')
  for (const name of readdirSync(sourceSkills)) {
    if (!name.startsWith('wecomcli-')) continue
    copyTreeWithoutDependencies(join(sourceSkills, name), join(skillsDest, name))
  }
  rmSync(tmp, { recursive: true, force: true })
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
      removeStagedEntry(destination)
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
    removeStagedEntry(linked)
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
    if (shouldSkipStagedRuntimeEntry(entry.name, entry.isDirectory())) continue
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
