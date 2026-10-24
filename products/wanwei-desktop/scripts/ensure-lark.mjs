/** Stage the pinned official Feishu CLI at build time; installed apps never download executables. */
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

export const LARK_VERSION = '1.0.98'
const hashes = {
  'darwin-x64': '44a4ff98e969385fc4bb4d701735ba319307e50560fa6c4c956178d70ccc3525',
  'darwin-arm64': 'ee4a3209bbf8b74ea5c00a07d0da89b79f5e7f6abfd518a8b2d78a7a4f7e3f40',
  'linux-x64': '4a12dcb7a0aab25986d8bcd046cb45b08278531a9aac3a12b53cf3d94738fe80',
  'linux-arm64': 'f798b26ce4b369d70411945e7f66bbe4382c411bc47d81950a662de7b69b41ed',
  'win32-x64': 'b13a5d710f9afe327b34bfe68c4a736a574d4d97274f6da862e912dfada1ccdc',
  'win32-arm64': '6a111ccfed1f89eca95fbf7a9ef0ae941b9017409a864bf6cd93becc430dc810',
}

/** Download a verified CLI for the build host, or copy an already verified staged binary.
 * @param {string} destination - Private runtime app directory.
 * @returns {Promise<string>} Native executable path.
 */
export async function ensureLark(destination) {
  const name = process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli'
  const target = join(destination, 'assets', `lark-${LARK_VERSION}`, name)
  const local = join(resolve(import.meta.dirname, '..'), 'assets', `lark-${LARK_VERSION}`, name)
  if (existsSync(target)) return target
  mkdirSync(dirname(target), { recursive: true })
  if (target !== local && existsSync(local)) { copyFileSync(local, target); return target }
  const expected = hashes[`${process.platform}-${process.arch}`]
  if (!expected) throw new Error(`Unsupported Feishu CLI platform: ${process.platform}-${process.arch}`)
  const platform = process.platform === 'win32' ? 'windows' : process.platform
  const arch = process.arch === 'x64' ? 'amd64' : process.arch
  const archiveName = `lark-cli-${LARK_VERSION}-${platform}-${arch}${platform === 'windows' ? '.zip' : '.tar.gz'}`
  let bytes
  for (const base of ['https://github.com/larksuite/cli/releases/download', 'https://registry.npmmirror.com/-/binary/lark-cli']) {
    try {
      const response = await fetch(`${base}/v${LARK_VERSION}/${archiveName}`, { signal: AbortSignal.timeout(120000) })
      if (!response.ok) throw new Error(`Feishu CLI download failed: ${response.status}`)
      bytes = Buffer.from(await response.arrayBuffer())
      break
    } catch (error) { if (base.includes('npmmirror.com')) throw error }
  }
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Feishu CLI checksum mismatch')
  const staging = mkdtempSync(join(tmpdir(), 'wanwei-lark-'))
  try {
    const archive = join(staging, archiveName)
    writeFileSync(archive, bytes)
    const result = spawnSync('tar', ['-xf', archive, '-C', staging], { windowsHide: true, encoding: 'utf8' })
    if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr)
    copyFileSync(join(staging, name), target)
    if (process.platform !== 'win32') chmodSync(target, 0o755)
  } finally { rmSync(staging, { recursive: true, force: true }) }
  return target
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  console.log(await ensureLark(resolve(import.meta.dirname, '..')))
}
