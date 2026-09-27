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
  responses.length = 0
  const polling = vm.runInContext('refresh()', context)
  const manual = vm.runInContext('refreshResult()', context)
  responses[1]({ ok: true, json: async () => ({ items: [{ id: 'polling-task', state: 'succeeded' }] }) })
  await manual
  responses[0]({ ok: true, json: async () => ({ items: [{ id: 'polling-task', state: 'running' }] }) })
  await polling
  assert.equal(vm.runInContext('tasks[0].state', context), 'succeeded')
})
import { createHash } from 'node:crypto'

test('standalone brand asset matches the legacy expert identity and manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('./web/assets/manifest.json', import.meta.url), 'utf8'))
  const entry = manifest.assets.find(asset => asset.filename === 'expert.png')
  assert.equal(entry.source, 'GeologyIconData.ts:layers')
  const bytes = readFileSync(new URL('./web/assets/expert.png', import.meta.url))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256)
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
  vm.runInContext('render()', context)
  vm.runInContext("selectedTask='reading-task'; currentPage='result'; render()", context)
  node('.task-details').open = true
  node('#main').scrollTop = 320
  vm.runInContext('render()', context)
  assert.equal(node('.task-details').open, true)
  assert.equal(node('#main').scrollTop, 320)
  vm.runInContext("selectedTask='another-task'; render()", context)
  assert.equal(node('.task-details').open, false)
  vm.runInContext("currentPage='home'; render()", context)
  assert.match(node('#main').innerHTML, /查看使用说明/)
  assert.match(node('#main').innerHTML, /接下来可以做什么/)
  assert.match(node('#main').innerHTML, /暂无分析记录/)
  vm.runInContext("form(tools[0]); selectedFiles=[{name:'范围.geojson',size:10}]; options.year='2101'; review()", context)
  assert.match(node('#toast').textContent, /2000–2100/)
  vm.runInContext("options.year=''; review()", context)
  assert.match(node('#toast').textContent, /2000–2100/)
  vm.runInContext("options.year='2000.5'; review()", context)
  assert.match(node('#toast').textContent, /整数/)
  vm.runInContext("options.year='2e3'; review()", context)
  assert.match(node('#toast').textContent, /整数/)
  vm.runInContext("currentPage='history'; render(); form(tools[0])", context)
  assert.match(node('#main').innerHTML, /id="upload" type="file" hidden/)
  assert.match(node('#main').innerHTML, /gis-prepare-aside/)
  assert.match(node('#main').innerHTML, /准备地块数据/)
  assert.match(node('#main').innerHTML, /本专家将交付/)
  assert.match(node('#main').innerHTML, /class="gis-terrain"/)
  assert.match(node('#main').innerHTML, /viewBox="0 0 560 190"/)
  assert.match(node('#main').innerHTML, /aria-hidden="true" focusable="false"/)
  assert.ok(node('#main').innerHTML.indexOf('gis-advanced') < node('#main').innerHTML.indexOf('gis-prepare-aside'))
  assert.match(node('#main').innerHTML, /<button type="button" id="dropzone" class="dropzone gis-upload">/)
  assert.match(node('#main').innerHTML, /assets\/upload.png/)
  assert.match(node('#main').innerHTML, /<details class="gis-advanced"><summary>高级选项<\/summary>/)
  assert.doesNotMatch(node('#main').innerHTML, /<details class="gis-advanced" open/)
  assert.match(node('#main').innerHTML, /不能猜测/)
  assert.doesNotMatch(node('#main').innerHTML, /data-param="title"/)
  node('#task-name').oninput({ target: { value: '同一个项目名称' } })
  assert.equal(vm.runInContext('options.title', context), '同一个项目名称')
  assert.equal(vm.runInContext('options.taskName', context), '同一个项目名称')
  let pickerOpened = 0
  node('#upload').click = () => { pickerOpened++ }
  node('#dropzone').onclick()
  assert.equal(pickerOpened, 1)
  let dropPrevented = false
  node('#dropzone').ondrop({
    preventDefault() { dropPrevented = true },
    dataTransfer: { files: [{ name: '拖入范围.geojson', size: 512 }] },
  })
  assert.equal(dropPrevented, true)
  assert.equal(vm.runInContext('selectedFiles[0].name', context), '拖入范围.geojson')
  assert.match(node('#filelist').innerHTML, /拖入范围.geojson/)
  assert.equal(navigation.find(item => item.dataset.page === 'home').active, true)
  assert.equal(navigation.find(item => item.dataset.page === 'history').active, false)
  vm.runInContext("currentPage='result'; render()", context)
  assert.equal(navigation.find(item => item.dataset.page === 'history').active, true)
  assert.equal(navigation.find(item => item.dataset.page === 'home').active, false)
  vm.runInContext("form(tools[0]); selectedFiles=[{name:'a.shp',size:10},{name:'b.shx',size:10},{name:'a.dbf',size:10}]; review()", context)
  assert.match(node('#toast').textContent, /必须同名/)
  vm.runInContext("selectedFiles=[{name:'a.shp',size:10},{name:'A.shx',size:10},{name:'a.dbf',size:10}]; review()", context)
  assert.match(node('#main').innerHTML, /核对分析信息/)
  assert.match(node('#main').innerHTML, /未填写；输入坐标保持原值，不自动转换/)
  assert.doesNotMatch(node('#main').innerHTML, /<dd>全部<\/dd>/)
  assert.match(node('#main').innerHTML, /gis-review-aside/)
  vm.runInContext("selectedFiles.push({name:'A.SHP',size:10}); review()", context)
  assert.match(node('#toast').textContent, /不能重复/)
  vm.runInContext(`
    const fixtureTool = { name: '测试', description: '', accept: '.pdf', multiple: true,
      params: [['focus', '要求', null, '默认']] }
    form(fixtureTool)
    selectedFiles = [{ name: '原始文件.geojson', size: 1024 }]
    options.focus = '用户修改'
    review()
    document.querySelector('#return').onclick()
  `, context)
  assert.equal(vm.runInContext('selectedFiles[0].name', context), '原始文件.geojson')
  assert.equal(vm.runInContext('options.focus', context), '用户修改')
  assert.match(node('#filelist').innerHTML, /原始文件.geojson/)
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
    currentPage = 'history'
    render()
  `, context)
  assert.match(node('#main').innerHTML, /data-task=/)
  assert.match(node('#main').innerHTML, /我的分析记录/)
  assert.match(node('#main').innerHTML, /筛选|data-filter=/)
  vm.runInContext("listQuery = '不存在'; render()", context)
  assert.doesNotMatch(node('#main').innerHTML, /data-task=/)
  vm.runInContext("listQuery = ''; historyFilter = 'failed'; render()", context)
  assert.doesNotMatch(node('#main').innerHTML, /data-task=/)
  vm.runInContext("historyFilter = 'all'; render()", context)
  assert.match(node('#main').innerHTML, /data-task=/)
  assert.doesNotMatch(node('#main').innerHTML, /<script>标题/)
  vm.runInContext("currentPage = 'files'; render()", context)
  assert.match(node('#main').innerHTML, /下载文件/)
  vm.runInContext("fileFilter = 'xlsx'; render()", context)
  assert.doesNotMatch(node('#main').innerHTML, /下载文件/)
  vm.runInContext("fileFilter = 'all'; render()", context)
  assert.match(node('#main').innerHTML, /&lt;报告&gt;.pdf/)
  vm.runInContext("selectedTask = 'a'.repeat(32); currentPage = 'result'; render()", context)
  assert.match(node('#main').innerHTML, /<details class="panel task-details"><summary>任务详情与输入参数<\/summary>/)
  vm.runInContext("tasks[0].tool=tools[0].id; tasks[0].state='failed'; render()", context)
  assert.match(node('#main').innerHTML, /重新创建分析/)
  assert.match(node('#main').innerHTML, /本次没有可展示的分析结果/)
  assert.doesNotMatch(node('#main').innerHTML, /等待分析结果/)
  vm.runInContext("tasks[0].state='cancelled'; render()", context)
  assert.match(node('#main').innerHTML, /分析已取消/)
  assert.doesNotMatch(node('#main').innerHTML, /等待分析结果/)
  vm.runInContext("tasks[0].state='running'; render()", context)
  assert.match(node('#main').innerHTML, /等待分析结果/)
  assert.doesNotMatch(node('#main').innerHTML, /download/)
  vm.runInContext("tasks[0].state='succeeded'; render()", context)
  assert.match(node('#main').innerHTML, /任务详情/)
  assert.match(node('#main').innerHTML, /gis-result-layout/)
  assert.match(node('#main').innerHTML, /gis-result-aside/)
  assert.match(node('#main').innerHTML, /data-refresh-result/)
  assert.match(node('#main').innerHTML, /3 分析与交付/)
  vm.runInContext(`analysisSummaries.set('a'.repeat(32), { title: '真实分析', datasets: [{ name: '图层', records: [[{ label: '字段', value: '<script>危险</script>' }]] }] }); render()`, context)
  assert.match(node('#main').innerHTML, /真实分析/)
  vm.runInContext("analysisSummaries.get('a'.repeat(32)).interpretation={text:'<script>测试解读</script>',model_generated:true}; render()", context)
  assert.match(node('#main').innerHTML, /综合解读（模型生成）/)
  assert.match(node('#main').innerHTML, /&lt;script&gt;测试解读&lt;\/script&gt;/)
  assert.doesNotMatch(node('#main').innerHTML, /<script>测试解读/)
  vm.runInContext("analysisSummaries.get('a'.repeat(32)).interpretation.text='## 综合结论\\n- **实际数据**需要核对。\\n## 关键发现\\n1. <script>危险</script>\\n## 成果文件\\n内部文件清单'; render()", context)
  assert.match(node('#main').innerHTML, /<h4>综合结论<\/h4>/)
  assert.match(node('#main').innerHTML, /<p>实际数据需要核对。<\/p>/)
  assert.match(node('#main').innerHTML, /<h4>关键发现<\/h4>/)
  assert.doesNotMatch(node('#main').innerHTML, /<h4>成果文件<\/h4>/)
  assert.match(node('#main').innerHTML, /查看完整模型回答/)
  assert.match(node('#main').innerHTML, /&lt;script&gt;危险&lt;\/script&gt;/)
  assert.doesNotMatch(node('#main').innerHTML, /<script>危险<\/script>/)
  let summaryPath
  context.fetch = async path => {
    summaryPath = path
    return { ok: true, headers: { get: () => '200' }, text: async () => JSON.stringify({ title: '接口结果', datasets: [{ name: '图层', records: [] }] }) }
  }
  await vm.runInContext("tasks[0].outputs.push('分析结果.json'); analysisSummaries.delete('a'.repeat(32)); loadSummary(tasks[0])", context)
  assert.ok(summaryPath.endsWith('/files/1'))
  assert.match(node('#main').innerHTML, /接口结果/)
  let refreshRequests = 0, releaseRefresh
  context.fetch = () => { refreshRequests++; return new Promise(resolve => { releaseRefresh = resolve }) }
  const refreshing = vm.runInContext('refreshResult()', context)
  await vm.runInContext('refreshResult()', context)
  assert.equal(refreshRequests, 1)
  assert.equal(node('[data-refresh-result]').disabled, true)
  releaseRefresh({ ok: false, json: async () => ({ error: '刷新暂不可用' }) })
  await refreshing
  assert.equal(node('[data-refresh-result]').disabled, false)
  assert.equal(vm.runInContext('resultRefreshing', context), false)
  assert.match(node('#toast').textContent, /刷新暂不可用/)
  assert.equal(vm.runInContext("analysisSummaries.has('a'.repeat(32))", context), true)
  context.updatedTasks = JSON.parse(vm.runInContext('JSON.stringify(tasks)', context))
  context.updatedTasks[0].state = 'queued'
  context.fetch = async () => ({ ok: true, json: async () => ({ items: context.updatedTasks }) })
  await vm.runInContext('refreshResult()', context)
  assert.equal(vm.runInContext("analysisSummaries.has('a'.repeat(32))", context), false)
  assert.match(node('#main').innerHTML, /等待分析/)
  assert.doesNotMatch(node('#main').innerHTML, /download/)
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
  vm.runInContext('moveFile(0, -1)', context)
  assert.equal(vm.runInContext('selectedFiles[0].name', context), '后选')
})
