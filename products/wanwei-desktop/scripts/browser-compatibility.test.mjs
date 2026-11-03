import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import { prepareBrowserCompatibility } from './browser-compatibility.mjs'

test('product assets and fetched plugins boot when modern standard APIs are missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wanwei-browser-'))
  try {
    const assets = join(root, 'apps/web/dist/assets')
    const lib = join(root, 'packages/example/plugin/lib')
    await mkdir(assets, { recursive: true })
    await mkdir(lib, { recursive: true })
    const html = '<html><head><script type="module" src="./assets/main.js"></script></head></html>'
    await writeFile(join(root, 'apps/web/dist/index.html'), html)
    await writeFile(join(assets, 'main.js'), 'class Main { static { this.ready = true } }; window.Main = Main')
    await writeFile(join(assets, 'main.css'), '.parent { & .child { color: blue } }')
    await writeFile(join(lib, 'index.js'), 'node-only artifact')
    await writeFile(join(lib, 'client.js'), `exports.check = async function () {
      const gate = Promise.withResolvers(); gate.resolve(7);
      return (await gate.promise) + [1, 2, 3].findLast(x => x < 3);
    }`)
    await prepareBrowserCompatibility(root)
    await prepareBrowserCompatibility(root)
    const builtHtml = await readFile(join(root, 'apps/web/dist/index.html'), 'utf8')
    assert.equal(builtHtml.match(/wanwei-browser-compat.js/g).length, 1)
    assert.ok(builtHtml.indexOf('wanwei-browser-compat.js') < builtHtml.indexOf('type="module"'))
    assert.equal(await readFile(join(lib, 'index.js'), 'utf8'), 'node-only artifact')
    const timers = []
    const context = vm.createContext({
      exports: {}, setTimeout: (fn, ms) => { timers.push([fn, ms]) },
      document: { getElementById: () => ({ childNodes: [1] }) },
      window: { addEventListener() {} },
    })
    vm.runInContext(`delete Promise.withResolvers; delete Array.prototype.findLast;
      delete Array.prototype.toSorted; delete globalThis.structuredClone`, context)
    vm.runInContext(await readFile(join(assets, 'wanwei-browser-compat.js'), 'utf8'), context)
    vm.runInContext(await readFile(join(lib, 'client.js'), 'utf8'), context)
    assert.equal(await context.exports.check(), 9)
    assert.equal(vm.runInContext('structuredClone(new Map([[1, 2]])).get(1)', context), 2)
    assert.equal(vm.runInContext('[3, 1].toSorted()[0]', context), 1)
    assert.equal(timers.some(([, ms]) => ms === 30000), true)
    for (const [fn] of timers) fn()
    const main = await readFile(join(assets, 'main.js'), 'utf8')
    assert.doesNotMatch(main, /static\s*\{/)
    assert.doesNotMatch(await readFile(join(assets, 'main.css'), 'utf8'), /&/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('startup failure offers reload without rendering error contents or token URLs', async () => {
  const source = await readFile(new URL('./browser-startup.js', import.meta.url), 'utf8')
  const root = { childNodes: [], appendChild(node) { this.childNodes.push(node) } }
  const timers = []
  const context = vm.createContext({
    document: {
      getElementById: () => root,
      createElement: () => ({ style: {}, children: [], appendChild(node) { this.children.push(node) } }),
    },
    window: { addEventListener() {}, location: { reload() {} } },
    setTimeout: fn => { timers.push(fn) },
  })
  vm.runInContext(source, context)
  timers[0]()
  timers[0]()
  assert.equal(root.childNodes.length, 1)
  assert.equal(root.childNodes[0].children[0].textContent, '页面加载未完成')
  assert.equal(root.childNodes[0].children[2].textContent, '重新加载')
})
