import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const product = new URL('../../', import.meta.url)
const rust = await readFile(new URL('src-tauri/src/lib.rs', product), 'utf8')
const production = rust.match(/const NATIVE_BRIDGE_INITIALIZATION_SCRIPT: &str = r#"([\s\S]*?)"#;/u)?.[1]
assert.ok(production, 'Locate the actual production initialization script')
const candidate = await readFile(new URL('native-bridge.js', import.meta.url), 'utf8')

test('current production bridge cannot invoke through the Tauri 1 global namespace', async () => {
  const window = { __TAURI__: { tauri: { invoke: async () => 'native-result' } } }
  runInNewContext(production, { window })
  await assert.rejects(window.__ZJUGIS_NATIVE_INVOKE__('list_custom_skills'))
})

for (const namespace of ['public', 'internal']) {
  test(`existing production bridge forwards through Tauri 2 ${namespace} API`, async () => {
    const calls = []
    const invoke = async (...args) => { calls.push(args); return 'native-result' }
    const window = namespace === 'public'
      ? { __TAURI__: { core: { invoke } } }
      : { __TAURI_INTERNALS__: { invoke } }
    runInNewContext(production, { window })
    assert.equal(await window.__ZJUGIS_NATIVE_INVOKE__('list_custom_skills', { slug: 'example' }), 'native-result')
    assert.deepEqual(calls, [['list_custom_skills', { slug: 'example' }]])
  })
}

test('Linux candidate preserves command arguments and response through both client entry points', async () => {
  const calls = []
  const result = { label: 'expert-probe' }
  const window = { __TAURI__: { tauri: { invoke: async (...args) => { calls.push(args); return result } } } }
  runInNewContext(candidate, { window })
  const args = { key: 'probe', ticket: 'test-only', x: 10, y: 20, width: 900, height: 600 }
  assert.equal(await window.__ZJUGIS_NATIVE_INVOKE__('open_expert_webview', args), result)
  assert.equal(await window.__TAURI__.core.invoke('open_expert_webview', args), result)
  assert.deepEqual(calls, [['open_expert_webview', args], ['open_expert_webview', args]])
})

test('Linux candidate preserves native failures', async () => {
  const rejected = new Error('native permission denied')
  const window = { __TAURI__: { tauri: { invoke: async () => { throw rejected } } } }
  runInNewContext(candidate, { window })
  await assert.rejects(window.__ZJUGIS_NATIVE_INVOKE__('install_custom_skill'), error => error === rejected)
  await assert.rejects(window.__TAURI__.core.invoke('install_custom_skill'), error => error === rejected)
})

test('Linux candidate fails explicitly without Tauri 1 and can be reinjected after initialization', async () => {
  assert.throws(() => runInNewContext(candidate, { window: {} }), /Tauri 1 invoke API is unavailable/u)
  const window = { __TAURI__: { tauri: { invoke: async () => 42 } } }
  runInNewContext(candidate, { window })
  runInNewContext(candidate, { window })
  assert.equal(await window.__ZJUGIS_NATIVE_INVOKE__('probe'), 42)
})
