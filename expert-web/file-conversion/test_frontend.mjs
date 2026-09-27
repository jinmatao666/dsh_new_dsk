import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import './test_session_frontend.mjs'
import './test_visual_consistency.mjs'

test('polling preserves the rendered page when task data is unchanged', async () => {
  const node = { querySelectorAll: () => [], classList: { toggle() {} } }
  const context = vm.createContext({
    document: { querySelector: () => node, querySelectorAll: () => [] },
    window: { addEventListener() {} }, location: { hash: '', pathname: '/' },
    history: { replaceState() {} }, URLSearchParams,
    fetch: () => new Promise(() => {}),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    renderCalls: 0,
  })
  vm.runInContext(readFileSync(new URL('./web/app.js', import.meta.url), 'utf8'), context)
  vm.runInContext('render = () => { renderCalls++ }', context)
  context.items = []
  context.fetch = async () => ({ ok: true, json: async () => ({ items: context.items }) })
  await vm.runInContext('refresh()', context)
  assert.equal(context.renderCalls, 1)
  await vm.runInContext('refresh()', context)
  assert.equal(context.renderCalls, 1)
  context.items = [{ id: 'polling-task', state: 'queued' }]
  await vm.runInContext('refresh()', context)
  assert.equal(context.renderCalls, 2)
  context.items = [{ id: 'polling-task', state: 'running' }]
  vm.runInContext("currentPage='form'", context)
  await vm.runInContext('refresh()', context)
  assert.equal(context.renderCalls, 2)
  assert.equal(vm.runInContext('tasks[0].state', context), 'running')
  const responses = []
  context.fetch = () => new Promise(resolve => { responses.push(resolve) })
  const older = vm.runInContext('refresh()', context)
  const newer = vm.runInContext('refresh()', context)
  responses[1]({ ok: true, json: async () => ({ items: [{ id: 'polling-task', state: 'succeeded' }] }) })
  await newer
  responses[0]({ ok: true, json: async () => ({ items: [{ id: 'polling-task', state: 'queued' }] }) })
  await older
  assert.equal(vm.runInContext('tasks[0].state', context), 'succeeded')
})

test('prepare, history and bounded desktop downloads retain user data', async () => {
  const nodes = new Map()
  const navigation = ['home', 'history', 'files', 'guide'].map(page => ({
    dataset: { page }, active: false,
    classList: { toggle(_name, active) { navigation.find(item => item.dataset.page === page).active = active } },
  }))
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, {
      innerHTML: '', classList: { toggle() {}, add() {}, remove() {} }, querySelectorAll: () => [],
    })
    return nodes.get(key)
  }
  const context = vm.createContext({
    document: { querySelector: node, querySelectorAll: selector => selector === 'aside [data-page]' ? navigation : [] },
    window: { addEventListener() {} },
    location: { hash: '', pathname: '/' },
    history: { replaceState() {} },
    URLSearchParams,
    fetch: () => new Promise(() => {}),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  })
  vm.runInContext(readFileSync(new URL('./web/app.js', import.meta.url), 'utf8'), context)
  vm.runInContext("currentPage = 'home'; render()", context)
  assert.match(node('#main').innerHTML, /选择一个工具，开始处理文件/)
  assert.equal((node('#main').innerHTML.match(/class="conversion-tool"/g) || []).length, 5)
  assert.match(node('#main').innerHTML, /原始文件不会被覆盖/)
  assert.doesNotMatch(node('#main').innerHTML, /三步完成处理/)
  for (const page of ['history', 'files']) {
    vm.runInContext(`currentPage='${page}'; render()`, context)
    assert.match(node('#main').innerHTML, /class="conversion-empty"/)
    assert.match(node('#main').innerHTML, /data-tool="word-pdf">新建处理/)
    assert.doesNotMatch(node('#main').innerHTML, /download/)
  }
  vm.runInContext("currentPage='history'; render(); form(tools[0])", context)
  assert.equal(navigation.find(item => item.dataset.page === 'home').active, true)
  assert.equal(navigation.find(item => item.dataset.page === 'history').active, false)
  for (const id of ['word-pdf', 'pdf-images', 'pdf-organize', 'images-pdf', 'image-optimize']) {
    vm.runInContext(`form(tools.find(tool => tool.id === '${id}'))`, context)
    assert.match(node('#main').innerHTML, /id="upload" type="file" hidden/)
    assert.ok(node('#main').innerHTML.includes(`/assets/${id}.png`))
    let opened = false
    node('#upload').click = () => { opened = true }
    node('#dropzone').onclick()
    assert.equal(opened, true)
  }
  vm.runInContext("form(tools[2]); selectedFiles = [{name:'a.pdf',size:10},{name:'b.pdf',size:10}]; options.mode='ranges'; review()", context)
  assert.match(node('#toast').textContent, /只能选择一个 PDF/)
  vm.runInContext('selectedFiles.pop(); review()', context)
  assert.match(node('#toast').textContent, /填写拆分页码范围/)
  vm.runInContext("form(tools[4]); selectedFiles=[{name:'a.jpg',size:10}]; options.quality='101'; review()", context)
  assert.match(node('#toast').textContent, /1–100/)
  vm.runInContext("form(tools[3]); selectedFiles=[{name:'a.jpg',size:10}]; options.margin=0; review()", context)
  assert.match(node('#main').innerHTML, /<dd>自动<\/dd>/)
  assert.match(node('#main').innerHTML, /<dd>0<\/dd>/)
  assert.doesNotMatch(node('#main').innerHTML, /<dd>auto<\/dd>/)
  vm.runInContext("form(tools[2]); selectedFiles=[{name:'a.pdf',size:10}]; review()", context)
  assert.match(node('#main').innerHTML, /<dd>合并<\/dd>/)
  assert.match(node('#main').innerHTML, /<dd>不适用<\/dd>/)
  vm.runInContext("form(tools[1]); selectedFiles=[{name:'a.pdf',size:10}]; review()", context)
  assert.match(node('#main').innerHTML, /<dd>全部页面<\/dd>/)
  for (const [id, expected] of [['word-pdf', '2 个 PDF 文件'], ['pdf-images', 'PNG 图片'], ['pdf-organize', '1 个合并后的 PDF 文件'], ['images-pdf', '1 个 PDF 文件'], ['image-optimize', '2 张 WEBP 图片']]) {
    vm.runInContext(`form(tools.find(tool => tool.id === '${id}')); selectedFiles=[{name:'a',size:10},{name:'b',size:10}]; options.taskName='<测试任务>'; review()`, context)
    assert.ok(node('#main').innerHTML.includes(expected))
    assert.match(node('#main').innerHTML, /&lt;测试任务&gt;/)
    assert.match(node('#main').innerHTML, /实际成果以任务完成后生成的文件为准/)
    assert.match(node('#main').innerHTML, /返回修改/)
  }
  vm.runInContext(`
    const fixtureTool = { name: '测试', description: '', accept: '.pdf', multiple: true,
      params: [['focus', '要求', null, '默认']] }
    form(fixtureTool)
    selectedFiles = [{ name: '原始文件.pdf', size: 1024 }]
    options.focus = '用户修改'
    review()
    document.querySelector('#return').onclick()
  `, context)
  assert.equal(vm.runInContext('selectedFiles[0].name', context), '原始文件.pdf')
  assert.equal(vm.runInContext('options.focus', context), '用户修改')
  assert.match(node('#filelist').innerHTML, /原始文件.pdf/)
  vm.runInContext('form(fixtureTool)', context)
  assert.equal(vm.runInContext('selectedFiles.length', context), 0)
  assert.equal(vm.runInContext('options.focus', context), '默认')
  vm.runInContext("selectFiles([{ name: 'first.pdf', size: 10 }])", context)
  vm.runInContext("selectFiles([{ name: 'second.pdf', size: 20 }], true)", context)
  assert.equal(vm.runInContext('selectedFiles.length', context), 2)
  vm.runInContext("selectFiles([{ name: 'wrong.exe', size: 30 }])", context)
  assert.equal(vm.runInContext('selectedFiles.length', context), 2)
  assert.match(node('#toast').textContent, /格式不支持/)
  vm.runInContext("selectFiles([{ name: 'large.pdf', size: 101 * 1024 * 1024 }])", context)
  assert.equal(vm.runInContext('selectedFiles.length', context), 2)
  vm.runInContext(`
    selectedFiles = [{ name: '先选', size: 1 }, { name: '后选', size: 2 }]
    moveFile(1, -1)
  `, context)
  assert.equal(vm.runInContext('selectedFiles[0].name', context), '后选')
  vm.runInContext(`
    tasks = [{ id: 'a'.repeat(32), tool: 'unknown', options: { title: '<script>标题</script>' },
      inputs: ['000.pdf'], created: 1, state: 'succeeded', outputs: ['<报告>.pdf'] }]
    currentPage = 'home'
    render()
  `, context)
  assert.match(node('#main').innerHTML, /&lt;script&gt;标题&lt;\/script&gt;/)
  assert.doesNotMatch(node('#main').innerHTML, /<script>标题<\/script>/)
  vm.runInContext(`
    currentPage = 'history'
    render()
  `, context)
  assert.match(node('#main').innerHTML, /data-task=/)
  assert.doesNotMatch(node('#main').innerHTML, /<script>标题/)
  vm.runInContext("currentPage = 'files'; render()", context)
  assert.match(node('#main').innerHTML, /下载文件/)
  assert.match(node('#main').innerHTML, /&lt;报告&gt;.pdf/)
  vm.runInContext("selectedTask = 'a'.repeat(32); currentPage = 'result'; render()", context)
  assert.equal(navigation.find(item => item.dataset.page === 'history').active, true)
  assert.equal(navigation.find(item => item.dataset.page === 'home').active, false)
  assert.match(node('#main').innerHTML, /任务详情/)
  assert.match(node('#main').innerHTML, /<h3>已完成<\/h3>/)
  assert.match(node('#main').innerHTML, /3 处理与交付/)
  assert.match(node('#main').innerHTML, /<section class="conversion-result succeeded"><header class="conversion-result-head">/)
  assert.doesNotMatch(node('#main').innerHTML, /conversion-state|state-success/)
  assert.match(node('#main').innerHTML, /<details class="conversion-task-details"><summary>任务详情/)
  assert.match(node('#main').innerHTML, /1 个输入文件/)
  assert.match(node('#main').innerHTML, /conversion-task-heading/)
  assert.ok(node('#main').innerHTML.indexOf('真实成果文件') < node('#main').innerHTML.indexOf('任务详情'))
  vm.runInContext("tasks[0].state = 'running'; render()", context)
  assert.match(node('#main').innerHTML, /<h3>正在处理<\/h3>/)
  assert.doesNotMatch(node('#main').innerHTML, /download/)
  vm.runInContext("tasks[0].state = 'failed'; tasks[0].error='<script>失败原因</script>'; render()", context)
  assert.match(node('#main').innerHTML, /&lt;script&gt;失败原因&lt;\/script&gt;/)
  assert.doesNotMatch(node('#main').innerHTML, /download/)
  vm.runInContext("tasks[0].state = 'cancelled'; render()", context)
  assert.match(node('#main').innerHTML, /<h3>已取消<\/h3>/)
  const saved = []
  const previewCreated = [], previewReleased = []
  context.Blob = Blob
  context.URL = {
    createObjectURL(file) { previewCreated.push(file); return 'blob:local-preview' },
    revokeObjectURL(url) { previewReleased.push(url) },
  }
  context.previewFile = Object.assign(new Blob(['image-bytes']), { name: '已选图片.png' })
  vm.runInContext('const previousSelections = selectedFiles; selectedFiles=[previewFile]; updateFileList(); updateFileList()', context)
  assert.equal(previewCreated.length, 1)
  assert.match(node('#filelist').innerHTML, /class="file-preview"/)
  assert.match(node('#filelist').innerHTML, /src="blob:local-preview"/)
  vm.runInContext('selectedFiles=[]; updateFileList(); selectedFiles=previousSelections', context)
  assert.deepEqual(previewReleased, ['blob:local-preview'])
  context.window.__ZJUGIS_NATIVE_INVOKE__ = async (command, args) => saved.push({ command, args })
  context.Blob = Blob
  context.FileReader = class {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(bytes => {
        this.result = 'data:application/octet-stream;base64,' + Buffer.from(bytes).toString('base64')
        this.onload()
      })
    }
  }
  context.testLink = { getAttribute: () => '/api/tasks/' + 'a'.repeat(32) + '/files/0' }
  context.fetch = async () => new Response('real-output', { headers: {
    'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent('成果报告.pdf'),
    'content-length': '11',
  } })
  await vm.runInContext('saveArtifact(testLink)', context)
  assert.equal(saved[0].command, 'save_expert_artifact')
  assert.equal(saved[0].args.fileName, '成果报告.pdf')
  assert.equal(Buffer.from(saved[0].args.bytesBase64, 'base64').toString(), 'real-output')
  context.fetch = async () => new Response('small-body', { headers: {
    'content-disposition': "attachment; filename*=UTF-8''report.pdf",
    'content-length': String(129 * 1024 * 1024),
  } })
  await assert.rejects(vm.runInContext('saveArtifact(testLink)', context), /128 MB/)
  assert.equal(saved.length, 1)
  vm.runInContext('moveFile(0, -1)', context)
  assert.equal(vm.runInContext('selectedFiles[0].name', context), '后选')
})
