/** Emit source evidence for a separate Tauri 1 shell; never claim native compilation. */
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const repository = new URL('../../../../', import.meta.url)
const load = path => readFile(new URL(path, repository), 'utf8')
const shellPath = 'products/wanwei-desktop/src-tauri/src/lib.rs'
const shell = await load(shellPath)
const cargo = await load('products/wanwei-desktop/src-tauri/Cargo.toml')
const update = await load('products/wanwei-desktop/src-tauri/src/desktop_update.rs')
const invokeBody = shell.match(/\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/u)?.[1]
if (!invokeBody) throw new Error('Cannot locate production native command registration')
const commands = invokeBody.split(',').map(value => value.trim()).filter(Boolean)
async function clients(path) {
  const found = []
  for (const item of await readdir(new URL(path, repository), { withFileTypes: true })) {
    const child = `${path}/${item.name}`
    if (item.isDirectory() && !['tests', 'node_modules', 'lib'].includes(item.name)) found.push(...await clients(child))
    else if (item.isFile() && /\.tsx?$/u.test(item.name) && !/\.(spec|test)\./u.test(item.name)) {
      const text = await load(child)
      if (text.includes('__TAURI__?.core?.invoke')) found.push(child)
    }
  }
  return found.sort()
}
const protectedPaths = [
  shellPath, 'products/wanwei-desktop/src-tauri/Cargo.toml',
  'products/wanwei-desktop/src-tauri/Cargo.lock', 'products/wanwei-desktop/src-tauri/tauri.conf.json',
  'products/wanwei-desktop/package.json', 'pnpm-lock.yaml',
  '.github/workflows/wanwei-desktop-preview.yml',
]
const hashes = Object.fromEntries(await Promise.all(protectedPaths.map(async path =>
  [path, createHash('sha256').update(await readFile(new URL(path, repository))).digest('hex')])))
let nativeProbe = { status: 'not-run' }
try {
  const evidence = JSON.parse(await readFile(new URL('native-probe/evidence.json', import.meta.url), 'utf8'))
  const checks = await Promise.all(Object.entries(evidence.sourceSha256).map(async ([name, hash]) =>
    createHash('sha256').update(await readFile(new URL('native-probe/' + name, import.meta.url))).digest('hex') === hash))
  nativeProbe = { status: evidence.passed && checks.every(Boolean) ? 'passed-at-recorded-sources' : 'stale-or-failed',
    architecture: evidence.architecture, scope: evidence.scope,
    maximumRequiredSymbolsIncludingResolvedLibraries: evidence.maximumRequiredSymbolsIncludingResolvedLibraries,
    notVerified: evidence.notVerified }
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
console.log(JSON.stringify({
  scope: 'Source inventory plus recorded native-probe evidence; neither validates the production shell.',
  target: { arch: 'aarch64', glibc: '2.31', glibcxx: '3.4.28', webkit: '4.0', soup: '2.4', tray: 'libappindicator3' },
  currentShellUsesTauri2: /tauri = \{ version = "2"/u.test(cargo),
  registeredNativeCommands: commands,
  directTauri2Clients: await clients('packages/wanwei'),
  nativeFeaturesToPort: {
    childWebviews: shell.includes('.add_child('),
    dynamicRemotePermissions: shell.includes('tauri::ipc::CapabilityBuilder'),
    documentTitleCallbacks: shell.includes('.on_document_title_changed('),
    cookieCleanup: shell.includes('.cookies_for_url(') && shell.includes('.delete_cookie('),
    appImageOnlyUpdates: update.includes('app.env().appimage.is_none()'),
  },
  readiness: {
    yamlOnlyMigration: false, productionShellCompiled: false,
    productionSidecarVerified: false, embeddedExpertParityVerified: false,
    kylinInstallationVerified: false, releaseReady: false,
  },
  nativeProbe,
  protectedFileSha256: hashes,
}, null, 2))
