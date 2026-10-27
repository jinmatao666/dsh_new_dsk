/** Export a single-platform signed release ZIP for the administrator upload page. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const platforms = {
  'windows-x64': ['windows-x86_64', 'nsis', '.exe'],
  'macos-x64': ['darwin-x86_64', 'macos', '.app.tar.gz'],
  'macos-arm64': ['darwin-aarch64', 'macos', '.app.tar.gz'],
  'linux-x64': ['linux-x86_64', 'appimage', '.AppImage'],
  'linux-arm64': ['linux-aarch64', 'appimage', '.AppImage'],
}

/** Produce immutable upload files without copying any signing secret into the release directory.
 * @param options - Explicit platform, version and output directory; signer is the Tauri CLI by default.
 * @returns The generated ZIP path.
 */
export async function packageUpdate({ platform, version, output, bundleRoot = join(root, 'src-tauri/target/release/bundle'), sign = signManifest }) {
  const spec = platforms[platform]
  if (!spec || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version)) throw new Error('更新发布平台或正式版本号无效')
  const [target, directory, extension] = spec
  const buildId = (await readFile(join(bundleRoot, '..', 'desktop-build-id.txt'), 'utf8')).trim()
  if (!/^\d{1,40}$/u.test(buildId)) throw new Error('缺少有效的桌面构建标识，请重新构建安装包')
  const folder = join(bundleRoot, directory)
  const candidates = (await readdir(folder)).filter(name => name.endsWith(extension))
  if (candidates.length !== 1) throw new Error('预期恰好一个自动更新产物；请清理旧构建结果')
  const source = join(folder, candidates[0])
  const size = (await stat(source)).size
  if (size <= 0 || size > 2 ** 31) throw new Error('自动更新产物为空或超过 2 GiB')
  const signature = (await readFile(`${source}.sig`, 'utf8')).trim()
  if (!signature || signature.length > 4096) throw new Error('缺少有效更新签名')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(source)) hash.update(chunk)
  const filename = `wanwei-buddy-${version}-${target}${extension}`
  const temporary = await mkdtemp(join(process.env.RUNNER_TEMP || (await import('node:os')).tmpdir(), 'wanwei-update-'))
  try {
    const manifest = join(temporary, 'release.json')
    await writeFile(manifest, `${JSON.stringify({ schema: 1, product: 'com.wanwei.harness', version, platform: target,
      file: filename, size, sha256: hash.digest('hex'), signature, build_id: buildId })}\n`, { flag: 'wx' })
    await sign(manifest)
    const archive = resolve(output, `wanwei-update-${version}-${target}.zip`)
    // Python's standard-library ZIP writer streams large artifacts and never receives signing credentials.
    const zip = spawnSync(process.platform === 'win32' ? 'python' : 'python3', [join(import.meta.dirname, 'package-update.py'), manifest, source, filename, archive], {
      windowsHide: true, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([name]) =>
        ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'LANG', 'HOME'].includes(name.toUpperCase()))),
    })
    if (zip.status !== 0) throw new Error('生成更新 ZIP 失败（请检查输出目录、Python 和磁盘空间）')
    return archive
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

function signManifest(path) {
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error('更新构建必须配置签名私钥')
  const result = spawnSync(process.execPath, [join(require.resolve('@tauri-apps/cli/package.json'), '..', 'tauri.js'), 'signer', 'sign', path], {
    windowsHide: true, encoding: 'utf8', cwd: root,
  })
  if (result.status !== 0) throw new Error('Tauri 发布清单签名失败；请检查构建密钥配置')
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const path = await packageUpdate({ platform: process.argv[2], version: process.env.DSH_RELEASE_VERSION, output: process.env.RUNNER_TEMP })
  process.stdout.write(`已生成后台上传包：${path}\n`)
}
