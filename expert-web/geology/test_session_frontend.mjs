import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

test('late preview body cannot refill the cache after expired login', async () => {
  const main = { innerHTML: '', querySelectorAll: () => [], classList: { toggle() {} } }
  let finishText
  const context = vm.createContext({
    document: { querySelector: () => main, querySelectorAll: () => [] },
    window: { addEventListener() {} }, location: { hash: '', pathname: '/' },
    history: { replaceState() {} }, URLSearchParams,
    fetch: () => new Promise(() => {}),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  })
  vm.runInContext(readFileSync(new URL('./web/app.js', import.meta.url), 'utf8'), context)
  context.fetch = async () => ({
    status: 200, ok: true, headers: { get: () => '10' },
    text: () => new Promise(resolve => { finishText = resolve }),
  })
  const preview = vm.runInContext("loadSummary({id:'a',state:'succeeded',tool:'summary',outputs:['分析结果.json']})", context)
  while (!finishText) await new Promise(resolve => setImmediate(resolve))
  vm.runInContext('expireSession()', context)
  finishText('private late body')
  await preview
  assert.equal(vm.runInContext('analysisSummaries.size', context), 0)
  assert.match(main.innerHTML, /登录已失效/)
  assert.equal(vm.runInContext('waitingDuration(100, 165000)', context), '1 分 05 秒')
  assert.equal(vm.runInContext('waitingDuration(100, 90000)', context), '0 分 00 秒')
})

test('artifact stream stops before native saving when login expires during a read', async () => {
  const main = { innerHTML: '', querySelectorAll: () => [], classList: { toggle() {} } }
  let saved = 0, cancelled = 0, released = 0, finishRead
  const context = vm.createContext({
    document: { querySelector: () => main, querySelectorAll: () => [] },
    window: { addEventListener() {}, __ZJUGIS_NATIVE_INVOKE__: async () => { saved++ } },
    location: { hash: '', pathname: '/' }, history: { replaceState() {} }, URLSearchParams,
    fetch: () => new Promise(() => {}),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  })
  vm.runInContext(readFileSync(new URL('./web/app.js', import.meta.url), 'utf8'), context)
  context.fetch = async () => ({
    status: 200, ok: true,
    headers: { get: name => name === 'content-disposition' ? "attachment; filename*=UTF-8''report.docx" : '4' },
    body: { getReader: () => ({
      read: () => new Promise(resolve => { finishRead = resolve }),
      cancel: async () => { cancelled++ }, releaseLock: () => { released++ },
    }) },
  })
  context.link = { getAttribute: () => '/api/tasks/a/files/0' }
  const download = vm.runInContext('saveArtifact(link)', context)
  const rejected = assert.rejects(download, /登录已失效/)
  while (!finishRead) await new Promise(resolve => setImmediate(resolve))
  vm.runInContext('expireSession()', context)
  finishRead({ done: false, value: new Uint8Array([1, 2, 3, 4]) })
  await rejected
  assert.equal(saved, 0)
  assert.equal(cancelled, 1)
  assert.equal(released, 1)
})

test('expired login clears private state and rejects late task responses', async () => {
  const main = { innerHTML: '', querySelectorAll: () => [], classList: { toggle() {} } }
  const context = vm.createContext({
    document: { querySelector: () => main, querySelectorAll: () => [] },
    window: { addEventListener() {} }, location: { hash: '', pathname: '/' },
    history: { replaceState() {} }, URLSearchParams,
    fetch: () => new Promise(() => {}),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  })
  vm.runInContext(readFileSync(new URL('./web/app.js', import.meta.url), 'utf8'), context)
  vm.runInContext("tasks=[{id:'private-task'}]; selectedFiles=[{name:'private-file'}]; options={title:'private-title'}", context)
  const responses = []
  context.fetch = () => new Promise(resolve => responses.push(resolve))
  const old = vm.runInContext('refresh()', context)
  const expired = vm.runInContext('refresh()', context)
  const rejectOld = assert.rejects(old, /登录已失效/)
  const rejectExpired = assert.rejects(expired, /登录已失效/)
  responses[1]({ status: 401, ok: false, json: async () => ({ error: 'expired' }) })
  await rejectExpired
  responses[0]({ status: 200, ok: true, json: async () => ({ items: [{ id: 'private-task' }] }) })
  await rejectOld
  assert.equal(vm.runInContext('tasks.length + selectedFiles.length + Object.keys(options).length', context), 0)
  assert.match(main.innerHTML, /登录已失效/)
  vm.runInContext("currentPage='history'; render(); form(tools[0])", context)
  assert.match(main.innerHTML, /登录已失效/)
  assert.doesNotMatch(main.innerHTML, /private-task|private-file|private-title/)
})
