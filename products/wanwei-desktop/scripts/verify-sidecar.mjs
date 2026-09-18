import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import process from 'node:process'

const productRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(productRoot, '..', '..')
const dshHome = await mkdtemp(join(tmpdir(), 'wanwei-desktop-sidecar-'))
const staged = process.argv.includes('--staged')
const releaseVersion = process.env.DSH_RELEASE_VERSION?.trim() || '0.1.0'
if (!/^[0-9A-Za-z][0-9A-Za-z.-]*$/u.test(releaseVersion)) {
  throw new Error(`DSH_RELEASE_VERSION contains an unsupported runtime directory character: ${releaseVersion}`)
}
const runtimeRoot = join(productRoot, 'src-tauri', 'resources', `runtime-${releaseVersion}`)
const program = staged
  ? join(runtimeRoot, process.platform === 'win32' ? 'node.exe' : 'node')
  : process.execPath
const entryArgs = staged
  ? [join(runtimeRoot, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')]
  : ['--import', 'tsx/esm', join(repositoryRoot, 'apps', 'cli', 'src', 'bin.ts')]
const cwd = staged ? join(runtimeRoot, 'app') : repositoryRoot
const child = spawn(program, [
  ...entryArgs,
  '--profile',
  'wanwei-desktop',
  '--host',
  '127.0.0.1',
  '--port',
  '0',
  '--no-open',
], {
  cwd,
  env: { ...process.env, DSH_HOME: dshHome },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', chunk => { output += chunk })
child.stderr.on('data', chunk => { output += chunk })

try {
  const url = await waitForReadyUrl()
  const response = await fetch(url, { redirect: 'manual' })
  if (response.status !== 303 || response.headers.get('location') !== '/') {
    throw new Error(`sidecar token exchange returned HTTP ${response.status}`)
  }
  if (!response.headers.get('set-cookie')?.includes('HttpOnly')) {
    throw new Error('sidecar token exchange omitted its HttpOnly session cookie')
  }
  process.stdout.write(`Wanwei desktop sidecar is ready at ${url.origin} with isolated DSH_HOME.\n`)
} finally {
  const exited = new Promise(resolveExit => child.once('exit', resolveExit))
  child.kill()
  await Promise.race([
    exited,
    new Promise(resolveTimeout => setTimeout(resolveTimeout, 3000)),
  ])
  await rm(dshHome, { recursive: true, force: true })
}

async function waitForReadyUrl() {
  // A cold Windows checkout may spend close to a minute loading the source
  // graph after a full Client build. Keep this source verification above that
  // observed ceiling; the packaged runtime remains covered by --staged.
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const match = /dsh web: (http:\/\/[^\s]+)/u.exec(output)
    if (match?.[1]) return new URL(match[1])
    if (child.exitCode !== null) throw new Error(`sidecar exited with ${child.exitCode}:\n${output}`)
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new Error(`sidecar did not become ready in 90 seconds:\n${output}`)
}
