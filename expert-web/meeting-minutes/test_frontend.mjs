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
  const shell = readFileSync(new URL('./web/index.html', import.meta.url), 'utf8')
  assert.match(shell, /新建纪要/)
  assert.match(shell, /我的纪要记录/)
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
  vm.runInContext("currentPage='history'; render(); form(tools[0])", context)
  assert.equal(navigation.find(item => item.dataset.page === 'home').active, true)
  assert.equal(navigation.find(item => item.dataset.page === 'history').active, false)
  vm.runInContext("currentPage='result'; render()", context)
  assert.equal(navigation.find(item => item.dataset.page === 'history').active, true)
  assert.equal(navigation.find(item => item.dataset.page === 'home').active, false)
  vm.runInContext("currentPage = 'home'; render()", context)
  assert.match(node('#main').innerHTML, /4 步完成会议纪要生成/)
  assert.match(node('#main').innerHTML, /最多上传 1 个/)
  assert.match(node('#main').innerHTML, /新建纪要/)
  assert.doesNotMatch(node('#main').innerHTML, /选择处理工具/)
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
  vm.runInContext('form(tools[0])', context)
  assert.equal(vm.runInContext("selectFiles([{ name: 'first.wav', size: 100 }, { name: 'second.m4a', size: 100 }])", context), false)
  assert.equal(vm.runInContext('selectedFiles.length', context), 0)
  assert.match(node('#toast').textContent, /最多选择一个录音/)
  vm.runInContext("selectedFiles = [{ name: '原录音.wav', size: 100 }, { name: '会议材料.txt', size: 100 }]", context)
  node('#audio-upload').onchange({ target: { files: [{ name: '新录音.m4a', size: 200 }], value: 'selected' } })
  assert.equal(vm.runInContext("selectedFiles.map(file => file.name).join(',')", context), '会议材料.txt,新录音.m4a')
  node('#dropzone').ondrop({ preventDefault() {}, dataTransfer: { files: [{ name: '拖入录音.mp3', size: 300 }] } })
  assert.equal(vm.runInContext("selectedFiles.map(file => file.name).join(',')", context), '会议材料.txt,拖入录音.mp3')
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
  assert.match(node('#main').innerHTML, /搜索会议名称/)
  vm.runInContext("historyQuery = '不存在'; render()", context)
  assert.doesNotMatch(node('#main').innerHTML, /data-task=/)
  vm.runInContext("historyQuery = ''; historyFilter = 'failed'; render()", context)
  assert.doesNotMatch(node('#main').innerHTML, /data-task=/)
  vm.runInContext("historyFilter = 'all'; render()", context)
  assert.match(node('#main').innerHTML, /data-task=/)
  assert.doesNotMatch(node('#main').innerHTML, /<script>标题/)
  vm.runInContext("currentPage = 'files'; render()", context)
  assert.match(node('#main').innerHTML, /下载文件/)
  assert.match(node('#main').innerHTML, /&lt;报告&gt;.pdf/)
  vm.runInContext("selectedTask = 'a'.repeat(32); currentPage = 'result'; render()", context)
  assert.match(node('#main').innerHTML, /会议纪要已生成/)
  assert.match(node('#main').innerHTML, /meeting-result-grid/)
  assert.match(node('#main').innerHTML, /meeting-task-info/)
  vm.runInContext("tasks[0].input_names = ['meeting.wav', 'agenda.docx']; render()", context)
  assert.match(node('#main').innerHTML, /src="\/assets\/audio.png"/)
  assert.match(node('#main').innerHTML, /src="\/assets\/material.png"/)
  assert.doesNotMatch(node('#main').innerHTML, /state-card|success-heading/)
  vm.runInContext("tasks[0].state = 'running'; render()", context)
  assert.match(node('#main').innerHTML, /正在生成纪要/)
  assert.match(node('#main').innerHTML, /不提供逐步骤进度/)
  assert.doesNotMatch(node('#main').innerHTML, /下载成果文件/)
  vm.runInContext("tasks[0].state = 'failed'; tasks[0].error = '<script>失败</script>'; render()", context)
  assert.match(node('#main').innerHTML, /本次纪要未完成/)
  assert.match(node('#main').innerHTML, /&lt;script&gt;失败&lt;\/script&gt;/)
  assert.doesNotMatch(node('#main').innerHTML, /<script>失败<\/script>/)
  vm.runInContext("tasks[0].state = 'succeeded'; tasks[0].error = ''; render()", context)
  vm.runInContext("executionSummaries.set('a'.repeat(32), { text: '<script>真实纪要</script>', truncated: false }); render()", context)
  assert.match(node('#main').innerHTML, /&lt;script&gt;真实纪要&lt;\/script&gt;/)
  assert.doesNotMatch(node('#main').innerHTML, /<script>真实纪要<\/script>/)
  const rich = vm.runInContext("meetingRichText('# 会议结论\\n- **完成复核**\\n1. 下一步\\n\\n| 负责人 | 事项 |\\n| --- | --- |\\n| <script> | 复核 |\\n| 项目组 |')", context)
  assert.match(rich, /<h4>会议结论<\/h4>/)
  assert.equal((rich.match(/class="meeting-answer-point"/g) || []).length, 2)
  assert.match(rich, /<th>负责人<\/th>/)
  assert.match(rich, /<td>&lt;script&gt;<\/td>/)
  assert.match(rich, /<td>—<\/td>/)
  assert.doesNotMatch(rich, /<script>|\*\*/)
  let summaryPath
  context.fetch = async path => {
    summaryPath = path
    return { ok: true, text: async () => JSON.stringify({ text: '接口摘要', truncated: true }) }
  }
  await vm.runInContext("executionSummaries.delete('a'.repeat(32)); loadSummary(tasks[0])", context)
  assert.ok(summaryPath.endsWith('/summary'))
  assert.match(node('#main').innerHTML, /接口摘要/)
  const saved = []
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
  vm.runInContext(`
    selectedTool = tools[0]
    selectedFiles = [{ name: 'a.wav', size: 10 }, { name: 'b.mp3', size: 20 }]
    review()
  `, context)
  assert.match(node('#toast').textContent, /最多选择一个录音/)
  vm.runInContext('moveFile(0, -1)', context)
  assert.equal(vm.runInContext('selectedFiles[0].name', context), 'a.wav')
})
