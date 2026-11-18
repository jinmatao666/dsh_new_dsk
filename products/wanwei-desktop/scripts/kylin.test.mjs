import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { prepareKylin } from './prepare-kylin.mjs'
import { emailPattern, lowerKylinMarkdown } from './kylin-markdown.mjs'

test('Kylin email matching retains upstream captures, positions and Unicode boundaries', () => {
  const constructor = `new RegExp(${JSON.stringify(emailPattern)}, "gu")`
  const { code, count } = lowerKylinMarkdown(constructor)
  assert.equal(count, 1)
  const adapted = vm.runInNewContext(code)
  const original = new RegExp(emailPattern, 'gu')
  const collect = (pattern, input) => {
    pattern.lastIndex = 0
    const matches = []
    let match
    while ((match = pattern.exec(input)) !== null) matches.push([match.index, ...Array.from(match)])
    return JSON.stringify(matches)
  }
  const prefixes = ['', ' ', '\n', '\t', '中文', 'a', '.', '+', '-', '/', '。', '😊', '𠮷', '\u0301', '\u00a0', '(', '©', '_']
  for (const first of prefixes) {
    for (const second of prefixes) {
      for (const address of ['test@example.com', 'a.b+tag@example.co.uk', '-a@b.cc', 'a@b.cc a@c.dd']) {
        const input = first + second + address
        assert.equal(collect(adapted, input), collect(original, input), input)
      }
    }
  }
  assert.deepEqual(lowerKylinMarkdown(code), { code, count: 0 })
  const other = 'new RegExp("other", "gu")'
  assert.equal(lowerKylinMarkdown(other).code, other)
})

const source = await readFile(new URL('../src-kylin/native-bridge.js', import.meta.url), 'utf8')
const compatibility = await readFile(new URL('../src-kylin/browser-compat.js', import.meta.url), 'utf8')
function compatiblePage({ native = false, origin = 'https://expert.example', child = false, main = false } = {}) {
  const window = {}
  window.self = window
  window.top = child ? {} : window
  const attributes = new Map()
  const document = { documentElement: { setAttribute: (name, value) => attributes.set(name, value) } }
  const context = vm.createContext({ document, window, location: { origin }, NativeAbortSignal: AbortSignal, AbortController })
  vm.runInContext(`
    function LegacyAbortSignal() {}
    LegacyAbortSignal.prototype = NativeAbortSignal.prototype;
    globalThis.AbortSignal = ${native ? 'NativeAbortSignal' : 'LegacyAbortSignal'};
  `, context)
  const install = () => vm.runInContext(compatibility.replace('__WANWEI_ORIGIN__', JSON.stringify('https://expert.example'))
    .replace('__WANWEI_MAIN_VIEW__', String(main)), context)
  install()
  return { context, install, attributes }
}

test('Kylin login layout is enabled only in the trusted main view, including native AbortSignal builds', () => {
  assert.ok(compatiblePage({ main: true, native: true }).attributes.has('data-wanwei-kylin'))
  assert.equal(compatiblePage().attributes.size, 0)
  assert.equal(compatiblePage({ main: true, child: true }).attributes.size, 0)
  assert.equal(compatiblePage({ main: true, origin: 'https://other.example' }).attributes.size, 0)
})

test('Kylin combines cancellation without replacing native signals or abort reasons', () => {
  const { context, install } = compatiblePage()
  vm.runInContext(`
    globalThis.first = new AbortController();
    globalThis.second = new AbortController();
    globalThis.reason = new Error('generation replaced');
    globalThis.combined = AbortSignal.any(new Set([first.signal, second.signal]));
    globalThis.events = 0;
    combined.addEventListener('abort', () => events++);
  `, context)
  assert.equal(context.combined instanceof AbortSignal, true)
  assert.equal(context.combined.aborted, false)
  context.second.abort(context.reason)
  assert.equal(context.combined.reason, context.reason)
  assert.throws(() => context.combined.throwIfAborted(), error => error === context.reason)
  context.first.abort(new Error('later abort'))
  assert.equal(context.events, 1)
  assert.equal(context.combined.reason, context.reason)
  const any = context.AbortSignal.any
  install()
  assert.equal(context.AbortSignal.any, any)
})

test('Kylin validates all sources and preserves first already-aborted reason', () => {
  const { context } = compatiblePage()
  context.first = AbortSignal.abort('first')
  context.second = AbortSignal.abort('second')
  assert.equal(vm.runInContext('AbortSignal.any([first, second]).reason', context), 'first')
  assert.equal(vm.runInContext('AbortSignal.any([]).aborted', context), false)
  for (const expression of ['AbortSignal.any()', 'AbortSignal.any(null)', 'AbortSignal.any({})',
    'AbortSignal.any([first, {}])', 'AbortSignal.any([null])']) {
    assert.throws(() => vm.runInContext(expression, context), { name: 'TypeError' })
  }
})

test('Kylin releases source listeners on abort and deduplicates repeated signals', () => {
  const { context } = compatiblePage()
  const first = new AbortController()
  const second = new AbortController()
  const listeners = new Set()
  for (const { signal } of [first, second]) {
    const add = signal.addEventListener.bind(signal)
    const remove = signal.removeEventListener.bind(signal)
    signal.addEventListener = (type, listener, options) => { listeners.add(listener); add(type, listener, options) }
    signal.removeEventListener = (type, listener) => { listeners.delete(listener); remove(type, listener) }
  }
  context.sources = [first.signal, first.signal, second.signal]
  const combined = vm.runInContext('AbortSignal.any(sources)', context)
  assert.equal(listeners.size, 2)
  first.abort()
  assert.equal(combined.reason, first.signal.reason)
  assert.equal(listeners.size, 0)
})

test('Kylin compatibility preserves native implementations and origin isolation', () => {
  const native = AbortSignal.any
  assert.equal(compatiblePage({ native: true }).context.AbortSignal.any, native)
  assert.equal(compatiblePage({ origin: 'https://foreign.example' }).context.AbortSignal.any, undefined)
  assert.equal(compatiblePage({ child: true }).context.AbortSignal.any, undefined)
})

test('completed requests do not retain subscriptions to a live application signal', async () => {
  await promisify(execFile)(process.execPath, ['--expose-gc', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import vm from 'node:vm';
    import { readFile } from 'node:fs/promises';
    import { setMaxListeners } from 'node:events';
    const window = {}; window.self = window; window.top = window;
    const context = vm.createContext({ window, location: { origin: 'https://expert.example' },
      AbortController, NativeAbortSignal: AbortSignal });
    vm.runInContext('function AbortSignal() {}; AbortSignal.prototype = NativeAbortSignal.prototype', context);
    const code = await readFile(new URL(process.argv[1]), 'utf8');
    vm.runInContext(code.replace('__WANWEI_ORIGIN__', JSON.stringify('https://expert.example'))
      .replace('__WANWEI_MAIN_VIEW__', 'false'), context);
    const lifetime = new AbortController();
    const active = new Set();
    const signal = lifetime.signal;
    setMaxListeners(0, signal);
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = (type, listener, options) => { active.add(listener); add(type, listener, options) };
    signal.removeEventListener = (type, listener) => { active.delete(listener); remove(type, listener) };
    context.source = signal;
    vm.runInContext('for (let i = 0; i < 100; i++) { AbortSignal.any([source]); }', context);
    assert.equal(active.size, 100);
    for (let i = 0; i < 100 && active.size; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      globalThis.gc();
    }
    assert.equal(active.size, 0, 'completed request subscriptions retained');
    assert.equal(signal.aborted, false);
  `, new URL('../src-kylin/browser-compat.js', import.meta.url).href], { timeout: 10000 })
})
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
    const browser = join(root, 'src-tauri/resources/runtime-1.2.3/app/browser.js')
    await mkdir(join(root, 'src-tauri/resources/runtime-1.2.3/app'), { recursive: true })
    const browserSource = `globalThis.email = new RegExp(${JSON.stringify(emailPattern)}, "gu");`
    await writeFile(browser, browserSource)
    const pluginCss = '.fade{background:linear-gradient(transparent,var(--dsw-specific-sidebar-fill))}'
      + '.dsh-knowledge-nav{background:radial-gradient(at 0 0,#e0edff,#0000 74%) top/100% 220px no-repeat,linear-gradient(165deg,#f5f8fd,#eef4fe)}'
      + '.seat{background:linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0px, var(--dsw-alias-bg-base) 36px)}'
      + '.other{background:linear-gradient(transparent,white)}'
    const plugin = `const css = ${JSON.stringify(pluginCss)};`
    await writeFile(join(root, 'src-tauri/resources/runtime-1.2.3/app/client.js'), plugin)
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
    assert.equal(await readFile(browser, 'utf8'), browserSource)
    assert.equal(await readFile(join(root, 'src-tauri/resources/runtime-1.2.3/app/client.js'), 'utf8'), plugin)
    const stagedPlugin = await readFile(join(root, 'src-kylin/resources/runtime-1.2.3/app/client.js'), 'utf8')
    assert.equal(stagedPlugin, `const css = ${JSON.stringify('.fade{background:none}'
      + '.dsh-knowledge-nav{background:linear-gradient(165deg,#f5f8fd,#eef4fe)}'
      + '.seat{background:var(--dsw-alias-bg-base)}'
      + '.other{background:linear-gradient(transparent,white)}')};`)
    const stagedBrowser = join(root, 'src-kylin/resources/runtime-1.2.3/app/browser.js')
    const stagedSource = await readFile(stagedBrowser, 'utf8')
    assert.doesNotMatch(stagedSource, /\(\?<=/u)
    assert.match(stagedSource, /sourceMappingURL=browser.js.map/u)
    assert.equal(JSON.parse(await readFile(stagedBrowser + '.map', 'utf8')).sourcesContent.length, 1)
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
