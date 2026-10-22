import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

if (process.platform !== 'win32') throw new Error('Expert WebView2 verification requires Windows.')
const root = resolve(import.meta.dirname, '..')
const build = spawnSync('cargo', ['build', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--example', 'expert-window-probe'], {
  cwd: root, stdio: 'inherit', windowsHide: true, timeout: 600_000,
})
if (build.error) throw build.error
if (build.status !== 0) throw new Error(`Native probe build failed: ${build.status}`)
const metadata = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', 'src-tauri/Cargo.toml'], {
  cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30_000,
})
if (metadata.error) throw metadata.error
if (metadata.status !== 0) throw new Error(`Cannot locate native probe: ${metadata.stderr}`)
const executable = resolve(JSON.parse(metadata.stdout).target_directory, 'debug/examples/expert-window-probe.exe')
for (const args of [['--reproduce-mismatch'], []]) {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 60_000 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Native expert-window verification failed: ${result.status}`)
}
