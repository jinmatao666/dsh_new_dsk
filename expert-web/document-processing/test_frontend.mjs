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
      innerHTML: '', classList: { toggle() {} }, querySelectorAll: () => [],
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
  for (const page of ['history', 'files']) {
    vm.runInContext(`currentPage='${page}'; render()`, context)
    assert.match(node('#main').innerHTML, /class="doc-empty"/)
    assert.match(node('#main').innerHTML, /data-tool="summary">新建处理/)
    assert.doesNotMatch(node('#main').innerHTML, /download/)
  }
  vm.runInContext("currentPage='history'; render(); form(tools[0])", context)
  assert.match(node('#main').innerHTML, /id="upload" type="file" hidden/)
  assert.match(node('#main').innerHTML, /class="dropzone doc-upload"/)
  let pickerOpened = false
  node('#upload').click = () => { pickerOpened = true }
  node('#dropzone').onclick()
  assert.equal(pickerOpened, true)
  assert.equal(navigation.find(item => item.dataset.page === 'home').active, true)
  assert.equal(navigation.find(item => item.dataset.page === 'history').active, false)
  vm.runInContext("currentPage='result'; render()", context)
  assert.equal(navigation.find(item => item.dataset.page === 'history').active, true)
  assert.equal(navigation.find(item => item.dataset.page === 'home').active, false)
  vm.runInContext("currentPage = 'home'; render()", context)
  assert.match(node('#main').innerHTML, /工作台说明/)
  assert.match(node('#main').innerHTML, /开始提取/)
  assert.match(node('#main').innerHTML, /开始对比/)
  assert.match(node('#main').innerHTML, /合计不超过 32 MB/)
  assert.doesNotMatch(node('#main').innerHTML, /三步完成处理/)
  context.summaryFixture = { text: '# 摘要\n实际内容\n## 风险与问题\n<script>原文</script>', truncated: true }
  const sections = vm.runInContext('summarySectionsMarkup(summaryFixture)', context)
  assert.match(sections, /<h3>风险与问题<\/h3>/)
  assert.match(sections, /&lt;script&gt;原文&lt;\/script&gt;/)
  assert.doesNotMatch(sections, /<script>/)
  context.richSummary = { text: '# 报告\n\n## 综合摘要\n普通**重点**正文\n- **一项**\n1. 顺序项\n### 局部标题\n<script>仅是文字</script>', truncated: false }
  const richSections = vm.runInContext('summarySectionsMarkup(richSummary)', context)
  assert.equal((richSections.match(/<section>/g) || []).length, 2)
  assert.match(richSections, /<h3>报告<\/h3>/)
  assert.match(richSections, /<p>普通<strong>重点<\/strong>正文<\/p>/)
  assert.match(richSections, /<ul><li><strong>一项<\/strong><\/li><\/ul>/)
  assert.match(richSections, /<ol><li>顺序项<\/li><\/ol>/)
  assert.match(richSections, /<h4>局部标题<\/h4>/)
  assert.match(richSections, /&lt;script&gt;仅是文字&lt;\/script&gt;/)
  assert.doesNotMatch(richSections, /<pre>|<script>|\*\*/)
  context.tableText = '| 时间 | 事件 |\n| --- | --- |\n| 2026年 | **审查** <sup>1</sup> |\n\n<source index="1" name="材料.docx">\n<script>alert(1)</script>'
  const tableMarkup = vm.runInContext('markdownMarkup(tableText)', context)
  assert.match(tableMarkup, /<table><thead>/)
  assert.match(tableMarkup, /<td><strong>审查<\/strong> <sup class="doc-source">\[1\]<\/sup><\/td>/)
  assert.match(tableMarkup, /来源 1：材料.docx/)
  assert.doesNotMatch(tableMarkup, /<script>|&lt;sup&gt;|&lt;source/)
  assert.match(sections, /请下载完整成果/)
  vm.runInContext('form(tools[0])', context)
  assert.match(node('#main').innerHTML, /data-focus="核心观点"/)
  assert.match(node('#main').innerHTML, /分析要求/)
  vm.runInContext("selectedFiles = [{ name: '摘要.docx', size: 1024 }]; options.focus = ''; review()", context)
  assert.match(node('#toast').textContent, /至少选择一个关注内容/)
  vm.runInContext("options.focus = '核心观点'; review()", context)
  assert.match(node('#main').innerHTML, /核对任务信息/)
  assert.match(node('#main').innerHTML, /核心观点/)
  vm.runInContext('form(tools[1])', context)
  assert.match(node('#main').innerHTML, /data-param="scope"/)
  assert.match(node('#main').innerHTML, /data-param="requirements"/)
  vm.runInContext("options.scope='数字变化'; options.requirements='重点核对预算'", context)
  assert.match(node('#main').innerHTML, /1 基准版本/)
  assert.match(node('#main').innerHTML, /2 对比版本/)
  vm.runInContext("setComparisonFile(1, [{ name: '新版.docx', size: 1024 }]); review()", context)
  assert.match(vm.runInContext('comparisonUploadMarkup()', context), /id="version-file-0" type="file" hidden/)
  assert.match(vm.runInContext('comparisonUploadMarkup()', context), /data-version-pick="1"/)
  assert.match(node('#toast').textContent, /分别上传基准版本/)
  vm.runInContext("setComparisonFile(0, [{ name: '基准.docx', size: 1024 }])", context)
  assert.equal(vm.runInContext("selectedFiles.map(file => file.name).join(',')", context), '基准.docx,新版.docx')
  assert.match(node('#filelist').innerHTML, /对比版本：新版.docx/)
  node('#swap-versions').onclick()
  assert.equal(vm.runInContext("selectedFiles.map(file => file.name).join(',')", context), '新版.docx,基准.docx')
  vm.runInContext("setComparisonFile(0, [{ name: '错误.exe', size: 1024 }])", context)
  assert.equal(vm.runInContext('comparisonFiles[0].name', context), '新版.docx')
  vm.runInContext('review(); document.querySelector("#return").onclick()', context)
  assert.equal(vm.runInContext('options.scope', context), '数字变化')
  assert.equal(vm.runInContext('options.requirements', context), '重点核对预算')
  vm.runInContext(`
    tasks = [{ id: 'analysis-test', tool: 'compare', options: {}, inputs: ['old.txt', 'new.txt'],
      created: 1, state: 'succeeded', outputs: [] }]
    selectedTask = 'analysis-test'
    resultPreviews.set('analysis-test', { counts: { added: 0, deleted: 0, modified: 1, unchanged: 0 },
      changes: [], analysis: { text: '<script>恶意文字</script>', model_generated: true } })
    currentPage = 'result'
    render()
  `, context)
  assert.match(node('#main').innerHTML, /重点变化分析（模型生成）/)
  assert.match(node('#main').innerHTML, /&lt;script&gt;恶意文字&lt;\/script&gt;/)
  assert.doesNotMatch(node('#main').innerHTML, /<script>恶意文字/)
  vm.runInContext(`
    resultPreviews.get('analysis-test').changes = Array.from({length:101}, (_, index) => ({
      type: ['added','deleted','modified'][index % 3], old: index % 3 === 0 ? [] : ['<原内容>'],
      new: index % 3 === 1 ? [] : ['<新内容>'],
    }))
    render()
  `, context)
  assert.equal((node('#main').innerHTML.match(/<article class="(?:added|deleted|modified)">/g) || []).length, 100)
  assert.match(node('#main').innerHTML, /<article class="added"><strong>新增 1<\/strong><p><small>新内容/)
  assert.match(node('#main').innerHTML, /<article class="deleted"><strong>删除 2<\/strong><p><small>原内容/)
  assert.match(node('#main').innerHTML, /<article class="modified"><strong>修改 3<\/strong>/)
  assert.match(node('#main').innerHTML, /&lt;原内容&gt;/)
  assert.match(node('#main').innerHTML, /&lt;新内容&gt;/)
  assert.match(node('#main').innerHTML, /前 100 项差异/)
  assert.match(node('#main').innerHTML, /文本内容对比不等同于视觉版式或 Word 修订比较/)
  assert.equal(vm.runInContext('comparisonFiles[1].name', context), '基准.docx')
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
  assert.match(node('#main').innerHTML, /<h3>已完成<\/h3>/)
  assert.match(node('#main').innerHTML, /真实成果文件/)
  assert.match(node('#main').innerHTML, /<section class="doc-result succeeded"><header class="doc-result-status">/)
  assert.doesNotMatch(node('#main').innerHTML, /doc-state|doc-progress|doc-result-overview/)
  assert.match(node('#main').innerHTML, /3 处理与交付/)
  vm.runInContext("tasks[0].state = 'running'; render()", context)
  assert.match(node('#main').innerHTML, /<h3>正在处理<\/h3>/)
  assert.doesNotMatch(node('#main').innerHTML, /下载文件/)
  vm.runInContext("tasks[0].state = 'failed'; tasks[0].error = '<script>错误</script>'; render()", context)
  assert.match(node('#main').innerHTML, /<h3>处理失败<\/h3>/)
  assert.match(node('#main').innerHTML, /&lt;script&gt;错误&lt;\/script&gt;/)
  vm.runInContext("tasks[0].state = 'succeeded'; tasks[0].error = ''; render()", context)
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
  context.window.__ZJUGIS_NATIVE_INVOKE__ = async () => 'C:\\Users\\test\\Desktop\\成果报告.pdf'
  assert.equal(await vm.runInContext('saveArtifact(testLink)', context), 'C:\\Users\\test\\Desktop\\成果报告.pdf')
  context.window.__ZJUGIS_NATIVE_INVOKE__ = async () => null
  assert.equal(await vm.runInContext('saveArtifact(testLink)', context), null)
  context.fetch = async () => new Response('small-body', { headers: {
    'content-disposition': "attachment; filename*=UTF-8''report.pdf",
    'content-length': String(129 * 1024 * 1024),
  } })
  await assert.rejects(vm.runInContext('saveArtifact(testLink)', context), /128 MB/)
  assert.equal(saved.length, 1)
  vm.runInContext('moveFile(0, -1)', context)
  assert.equal(vm.runInContext('selectedFiles[0].name', context), '后选')
})
