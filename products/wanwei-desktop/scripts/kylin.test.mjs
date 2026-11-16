import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import { prepareKylin } from './prepare-kylin.mjs'

const source = await readFile(new URL('../src-kylin/native-bridge.js', import.meta.url), 'utf8')
function page({ origin = 'https://expert.example', child = false } = {}) {
  const messages = []
  const timers = new Map()
  let timerId = 0
  const window = { webkit: { messageHandlers: { wanwei: { postMessage: raw => messages.push(JSON.parse(raw)) } } } }
  window.self = window
  window.top = child ? {} : window
  const context = vm.createContext({
    window, location: { origin }, crypto: webcrypto,
    setTimeout: fn => { timers.set(++timerId, fn); return timerId },
    clearTimeout: id => timers.delete(id),
  })
  vm.runInContext(source.replace('__WANWEI_ORIGIN__', JSON.stringify('https://expert.example'))
    .replace('__WANWEI_NONCE__', JSON.stringify('test-channel-token')), context)
  return { window, messages, timers }
}

test('shared invoke contracts return native values and release pending calls', async () => {
  const { window, messages, timers } = page()
  assert.equal(window.__TAURI__.core.invoke, window.__ZJUGIS_NATIVE_INVOKE__)
  assert.equal(window.__TAURI__.tauri.invoke, window.__ZJUGIS_NATIVE_INVOKE__)
  const result = window.__ZJUGIS_NATIVE_INVOKE__('read_analysis_view', { path: '/tmp/result.json' })
  assert.equal(messages[0].args.path, '/tmp/result.json')
  assert.equal(messages[0].nonce, 'test-channel-token')
  window.__WANWEI_NATIVE_REPLY__({ ...messages[0], ok: true, value: { ready: true } })
  assert.equal((await result).ready, true)
  assert.equal(timers.size, 0)
})

test('native rejection and transport failure preserve errors', async () => {
  const { window, messages, timers } = page()
  const result = window.__ZJUGIS_NATIVE_INVOKE__('save_expert_artifact')
  window.__WANWEI_NATIVE_REPLY__({ ...messages[0], ok: false, error: 'permission denied' })
  await assert.rejects(result, /permission denied/u)
  window.webkit.messageHandlers.wanwei.postMessage = () => { throw new Error('channel closed') }
  await assert.rejects(window.__ZJUGIS_NATIVE_INVOKE__('read_analysis_view'), /channel closed/u)
  assert.equal(timers.size, 0)
})

test('a reply for the previous document cannot resolve a new page request', async () => {
  const old = page()
  const current = page()
  const result = current.window.__ZJUGIS_NATIVE_INVOKE__('read_analysis_view')
  const other = old.window.__ZJUGIS_NATIVE_INVOKE__('read_analysis_view')
  current.window.__WANWEI_NATIVE_REPLY__({ ...old.messages[0], ok: true, value: 'wrong document' })
  assert.equal(current.timers.size, 1)
  current.window.__WANWEI_NATIVE_REPLY__({ ...current.messages[0], ok: true, value: 'current document' })
  old.window.__WANWEI_NATIVE_REPLY__({ ...old.messages[0], ok: true, value: 'old document' })
  assert.equal(await result, 'current document')
  await other
})

test('foreign origins and embedded frames receive no bridge', () => {
  assert.equal(page({ origin: 'https://foreign.example' }).window.__ZJUGIS_NATIVE_INVOKE__, undefined)
  assert.equal(page({ child: true }).window.__ZJUGIS_NATIVE_INVOKE__, undefined)
})

test('timed out requests reject and release their state', async () => {
  const { window, timers } = page()
  const result = window.__ZJUGIS_NATIVE_INVOKE__('read_analysis_view')
  for (const callback of timers.values()) callback()
  await assert.rejects(result, /超时/u)
})

test('Kylin staging keeps shared runtime identity and rejects missing runtimes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wanwei-kylin-stage-'))
  try {
    await mkdir(join(root, 'src-tauri/resources/runtime-1.2.3'), { recursive: true })
    await mkdir(join(root, 'src-tauri/icons'), { recursive: true })
    await mkdir(join(root, 'src-kylin'), { recursive: true })
    await writeFile(join(root, 'src-tauri/resources/server.json'), '{}')
    await writeFile(join(root, 'src-tauri/resources/runtime-1.2.3/node'), 'shared-node-fixture')
    await writeFile(join(root, 'src-tauri/icons/32x32.png'), 'shared-icon-fixture')
    await writeFile(join(root, 'src-kylin/tauri.conf.json'), '{"package":{"version":"0.1.0"}}')
    for (const platform of ['linux-x64', 'linux-arm64', 'darwin-x64', 'win32-x64']) {
      const directory = join(root, 'src-tauri/resources/runtime-1.2.3/app/prebuilds', platform)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'pty.node'), platform)
    }
    for (const platform of ['linux_arm64', 'musl_arm64']) {
      const directory = join(root, 'src-tauri/resources/runtime-1.2.3/app/node_modules/@koromix/koffi-linux-arm64', platform)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'koffi.node'), platform)
    }
    for (const platform of ['x64', 'arm64']) {
      const directory = join(root, 'src-tauri/resources/runtime-1.2.3/app/node_modules/@deepseek-ai/node-addon-landlock-run-linux-' + platform)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'binding.node'), platform)
    }
    await mkdir(join(root, 'src-kylin/resources/runtime-obsolete'), { recursive: true })
    assert.throws(() => prepareKylin(root, '../invalid'), /version/u)
    assert.throws(() => prepareKylin(root, '1.2.4'), /runtime-1.2.4/u)
    prepareKylin(root, '1.2.3', 'arm64')
    assert.equal(await readFile(join(root, 'src-kylin/resources/runtime-1.2.3/node'), 'utf8'), 'shared-node-fixture')
    assert.equal(JSON.parse(await readFile(join(root, 'src-kylin/tauri.runner.conf.json'), 'utf8')).package.version, '1.2.3')
    await assert.rejects(readFile(join(root, 'src-kylin/resources/runtime-obsolete')), { code: 'ENOENT' })
    assert.equal(await readFile(join(root, 'src-kylin/resources/runtime-1.2.3/app/prebuilds/linux-arm64/pty.node'), 'utf8'), 'linux-arm64')
    for (const platform of ['linux-x64', 'darwin-x64', 'win32-x64']) {
      await assert.rejects(readFile(join(root, 'src-kylin/resources/runtime-1.2.3/app/prebuilds', platform, 'pty.node')), { code: 'ENOENT' })
    }
    assert.equal(await readFile(join(root, 'src-kylin/resources/runtime-1.2.3/app/node_modules/@koromix/koffi-linux-arm64/linux_arm64/koffi.node'), 'utf8'), 'linux_arm64')
    await assert.rejects(readFile(join(root, 'src-kylin/resources/runtime-1.2.3/app/node_modules/@koromix/koffi-linux-arm64/musl_arm64/koffi.node')), { code: 'ENOENT' })
    assert.equal(await readFile(join(root, 'src-kylin/resources/runtime-1.2.3/app/node_modules/@deepseek-ai/node-addon-landlock-run-linux-arm64/binding.node'), 'utf8'), 'arm64')
    await assert.rejects(readFile(join(root, 'src-kylin/resources/runtime-1.2.3/app/node_modules/@deepseek-ai/node-addon-landlock-run-linux-x64/binding.node')), { code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
