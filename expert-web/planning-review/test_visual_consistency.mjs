import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

test('guide uses four instruction cards and navigation uses original expert icons', () => {
  const main = { innerHTML: '', querySelectorAll: () => [], classList: { toggle() {} } }
  const context = vm.createContext({
    document: { querySelector: () => main, querySelectorAll: () => [] },
    window: { addEventListener() {} }, location: { hash: '', pathname: '/' },
    history: { replaceState() {} }, URLSearchParams,
    fetch: () => new Promise(() => {}),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  })
  vm.runInContext(readFileSync(new URL('./web/app.js', import.meta.url), 'utf8'), context)
  vm.runInContext("currentPage='guide'; render()", context)
  assert.match(main.innerHTML, /class="guide-hero"/)
  assert.match(main.innerHTML, /class="guide-grid"/)
  assert.equal((main.innerHTML.match(/class="panel"/g) || []).length, 4)
  assert.match(main.innerHTML, /data-page="home"/)
  assert.match(main.innerHTML, /data-tool="/)
  const html = readFileSync(new URL('./web/index.html', import.meta.url), 'utf8')
  const nav = html.match(/<nav>(.*?)<\/nav>/s)[1]
  assert.equal((nav.match(/class="ui-icon"/g) || []).length, 4)
  assert.equal((nav.match(/aria-hidden="true"/g) || []).length, 4)
  assert.equal((nav.match(/<img /g) || []).length, 4)
})
