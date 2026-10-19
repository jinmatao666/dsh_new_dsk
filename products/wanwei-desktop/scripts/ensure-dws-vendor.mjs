/**
 * Materialize `dingtalk-workspace-cli/vendor/dws[.exe]` without running the
 * package postinstall (pnpm ignores its build scripts; that postinstall also
 * writes skills into agent homes, which the product does not want).
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import process from 'node:process'

const require = createRequire(import.meta.url)
const packageRoot = dirname(require.resolve('dingtalk-workspace-cli/package.json'))
const binaryName = process.platform === 'win32' ? 'dws.exe' : 'dws'
const vendorBinary = join(packageRoot, 'vendor', binaryName)
if (existsSync(vendorBinary)) {
  process.stdout.write(`DWS vendor binary already present: ${vendorBinary}\n`)
  process.exit(0)
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
  throw new Error(`Missing DWS archive: ${archive}`)
}

const tmp = mkdtempSync(join(tmpdir(), 'wanwei-dws-vendor-'))
try {
  const extract = platformArchive.endsWith('.tar.gz')
    ? spawnSync('tar', ['-xzf', archive, '-C', tmp], { encoding: 'utf8' })
    : spawnSync('tar', ['-xf', archive, '-C', tmp], { encoding: 'utf8' })
  if (extract.status !== 0) {
    throw new Error(`Failed to extract DWS archive:\n${extract.stderr || extract.stdout}`)
  }
  const found = findFileNamed(tmp, binaryName)
  if (found === undefined) {
    throw new Error(`DWS binary ${binaryName} not found inside ${platformArchive}`)
  }
  const vendorDir = join(packageRoot, 'vendor')
  mkdirSync(vendorDir, { recursive: true })
  copyFileSync(found, vendorBinary)
  if (process.platform !== 'win32') chmodSync(vendorBinary, 0o755)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

process.stdout.write(`DWS vendor binary staged at ${vendorBinary}\n`)

/**
 * @param {string} root
 * @param {string} name
 * @returns {string | undefined}
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
