import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

test('expert input trace is dormant, content-free and bounded', async () => {
  const listeners = new Map()
  const calls = []
  class Element {
    localName = 'button'
    value = 'private-value'
    textContent = 'private-text'
    closest() { return this }
  }
  const addEventListener = (name, callback) => {
    const existing = listeners.get(name) ?? []
    existing.push(callback)
    listeners.set(name, existing)
  }
  const emit = (name, event = {}) => {
    for (const callback of listeners.get(name) ?? []) callback(event)
  }
  const window = { addEventListener, __TAURI_INTERNALS__: {
    invoke: async (...args) => { calls.push(args) },
  } }
  const document = { addEventListener, hasFocus: () => true, elementFromPoint: () => new Element() }
  runInNewContext(readFileSync(new URL('../src-tauri/src/expert_diagnostics.js', import.meta.url), 'utf8'), {
    window, document, Element, innerWidth: 1120, innerHeight: 720,
    performance: { now: () => 1000 }, queueMicrotask, setTimeout, clearTimeout,
  })
  const event = { isTrusted: true, target: new Element(), clientX: 35, clientY: 42, defaultPrevented: false }
  emit('click', event)
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(calls.length, 0)
  emit('wanwei:expert-diagnostics-start')
  emit('click', { ...event, isTrusted: false })
  assert.equal(calls.length, 1)
  emit('click', event)
  event.defaultPrevented = true
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.deepEqual(calls.map(([, args]) => args.event.event), ['start', 'click', 'settled-click'])
  assert.equal(calls[1][1].event.tag, 'button')
  assert.equal(calls[1][1].event.x, 35)
  assert.equal(calls[2][1].event.blocked, true)
  assert.equal(JSON.stringify(calls).includes('private-'), false)
  for (let i = 0; i < 400; i++) emit('click', event)
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(calls.length, 300)
})

test('diagnostic permission belongs only to the main desktop capability', () => {
  const capability = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/desktop.json', import.meta.url), 'utf8'))
  assert.deepEqual(capability.webviews, ['main'])
  assert.ok(capability.permissions.includes('allow-expert-input-diagnostic'))
  const native = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
  const expertPermissions = native.slice(native.indexOf('let mut capability ='), native.indexOf('let navigation_app'))
  assert.equal(expertPermissions.includes('allow-expert-input-diagnostic'), false)
})
