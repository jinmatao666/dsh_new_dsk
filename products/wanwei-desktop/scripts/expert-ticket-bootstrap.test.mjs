import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'

const template = readFileSync(new URL('../src-tauri/src/expert_ticket_bootstrap.js', import.meta.url), 'utf8')

function mount({ href = 'http://expert.test/experts/meeting-minutes/', child = false, storage = new Map(), marker = 'launch-1' } = {}) {
  const location = new URL(href)
  const launch = {
    origin: 'http://expert.test', path: '/experts/meeting-minutes/', search: '', targetSearch: '',
    fragment: `#ticket=${'a'.repeat(64)}`, marker,
  }
  const replacements = []
  const window = {}
  window.self = window
  window.top = child ? {} : window
  const context = createContext({ window, location,
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    history: { replaceState(_state, _unused, path) { replacements.push(path); location.href = new URL(path, location).href } },
  })
  const run = () => runInContext(template.replace('__WANWEI_EXPERT_LAUNCH__', JSON.stringify(launch)), context)
  return { location, launch, storage, replacements, run }
}

test('initial HTTP navigation excludes ticket; bootstrap makes it readable before website boot', () => {
  const page = mount()
  assert.equal(page.location.hash, '')
  assert.equal(page.location.pathname.includes('%23'), false)
  page.run()
  assert.equal(new URLSearchParams(page.location.hash.slice(1)).get('ticket'), 'a'.repeat(64))
  assert.equal(page.location.pathname, '/experts/meeting-minutes/')
  assert.equal(page.replacements.length, 1)
  assert.equal([...page.storage.values()].includes('a'.repeat(64)), false)
})

test('reload uses website session instead of replaying the consumed ticket', () => {
  const first = mount()
  first.run()
  const reload = mount({ storage: first.storage })
  reload.run()
  assert.equal(reload.location.hash, '')
  assert.equal(reload.replacements.length, 0)
})

test('a fresh launch can inject its new ticket independently', () => {
  const first = mount()
  first.run()
  const next = mount({ storage: first.storage, marker: 'launch-2' })
  next.run()
  assert.equal(next.replacements.length, 1)
})

for (const href of [
  'http://other.test/experts/meeting-minutes/',
  'https://expert.test/experts/meeting-minutes/',
  'http://expert.test:8080/experts/meeting-minutes/',
  'http://expert.test/experts/other/',
  'http://expert.test/experts/meeting-minutes/?unexpected=1',
]) {
  test(`does not inject ticket into a redirected document: ${href}`, () => {
    const page = mount({ href })
    page.run()
    assert.equal(page.location.hash, '')
    assert.equal(page.storage.size, 0)
  })
}

test('does not inject ticket into an iframe', () => {
  const page = mount({ child: true })
  page.run()
  assert.equal(page.replacements.length, 0)
  assert.equal(page.storage.size, 0)
})

test('hash router preserves its route and receives a query ticket', () => {
  const page = mount()
  page.launch.fragment = '#/ai?mode=review'
  page.launch.targetSearch = '?ticket=' + 'a'.repeat(64)
  page.run()
  assert.equal(page.location.hash, '#/ai?mode=review')
  assert.equal(page.location.searchParams.get('ticket'), 'a'.repeat(64))
  assert.equal(page.replacements.length, 1)
})
