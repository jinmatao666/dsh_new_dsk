// Local-only screenshot runner for the independent expert sites. Never use production identities.
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [site, url, outputDirectory] = process.argv.slice(2)
const fixtures = {
  'document-processing': { tool: 'summary', names: ['方案.docx'], output: '文档摘要与要点.md', title: '项目方案摘要' },
  'file-conversion': { tool: 'word-pdf', names: ['方案.docx'], output: '方案.pdf', title: '方案转换' },
  geology: { tool: 'analysis', names: ['范围.geojson'], output: '分析结果.json', title: '项目地质分析' },
  'third-survey': { tool: 'analysis', names: ['范围.geojson'], output: '分析结果.json', title: '三调分析' },
  'planning-review': { tool: 'analysis', names: ['范围.geojson'], output: '分析结果.json', title: '规划审查' },
}
if (!fixtures[site] || !url?.startsWith('http://127.0.0.1:') || !outputDirectory) {
  throw new Error('Usage: node visual_audit.mjs <site> <local preview URL> <screenshot directory>')
}
const fixture = fixtures[site]
const profile = await mkdtemp(join(tmpdir(), 'expert-visual-chrome-'))
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
try {
  let port
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break }
    catch { await delay(100) }
  }
  if (!port) throw new Error('Chrome debugging endpoint did not start')
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let sequence = 0
  const pending = new Map()
  socket.onmessage = event => {
    const value = JSON.parse(event.data)
    if (!value.id) return
    const deferred = pending.get(value.id)
    if (!deferred) return
    pending.delete(value.id)
    value.error ? deferred.reject(new Error(value.error.message)) : deferred.resolve(value.result)
  }
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Page.navigate', { url })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate("document.querySelector('#main')?.textContent?.length > 100")) break
    await delay(100)
  }
  await evaluate('clearInterval(timer)')
  const stablePolling = await evaluate(`(async () => {
    currentPage='history'; render()
    const main=document.querySelector('#main'), marker=main.firstElementChild
    marker.tabIndex=0; marker.focus()
    await refresh()
    if(main.firstElementChild!==marker || document.activeElement!==marker) return false
    form(tools[0])
    const input=main.querySelector('input:not([type="file"])')
    input.focus(); input.value='浏览器输入保持测试'; input.dispatchEvent(new Event('input',{bubbles:true}))
    await refresh()
    return main.contains(input) && document.activeElement===input && input.value==='浏览器输入保持测试'
  })()`)
  if (!stablePolling) throw new Error('Unchanged local task polling replaced DOM or lost input focus')
  await mkdir(outputDirectory, { recursive: true })
  async function screenshot(name, expression) {
    await evaluate(expression)
    await delay(180)
    const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(join(outputDirectory, `${name}.png`), Buffer.from(data, 'base64'))
  }
  async function narrowScreenshots(name) {
    for (const width of [900, 760]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
      await screenshot(`${name}-${width}`, 'document.querySelector("#main").scrollTop = 0')
      const overflow = await evaluate('document.querySelector("#main").scrollWidth - document.querySelector("#main").clientWidth')
      if (overflow > 1) throw new Error(`${site} ${name} at ${width}px has ${overflow}px horizontal overflow`)
    }
    await call('Emulation.clearDeviceMetricsOverride')
  }
  const filenames = JSON.stringify(fixture.names.map(name => ({ name, size: 2048 })))
  const task = JSON.stringify({ id: 'a'.repeat(32), tool: fixture.tool, options: { taskName: fixture.title, title: fixture.title },
    inputs: fixture.names, input_names: fixture.names, created: 1790388000, state: 'queued', outputs: [] })
  await screenshot('01-home', "currentPage = 'home'; render()")
  await screenshot('02-prepare', `form(tools.find(tool => tool.id === ${JSON.stringify(fixture.tool)}) || tools[0]); selectedFiles = ${filenames}; updateFileList()`)
  await narrowScreenshots('02-prepare')
  if (['geology', 'third-survey', 'planning-review'].includes(site)) {
    const terrainReady = await evaluate(`(() => {
      const svg=document.querySelector('.gis-terrain'); const box=svg?.getBoundingClientRect()
      return box?.width>0 && box.height===120 && svg.querySelectorAll('path[stroke-width]').length===7 && svg.getAttribute('aria-hidden')==='true'
    })()`)
    if (!terrainReady) throw new Error('Legacy terrain illustration is missing or incorrectly rendered')
  }
  if (['geology', 'third-survey', 'planning-review'].includes(site)) {
    await screenshot('02b-advanced-options', "document.querySelector('.gis-advanced').open = true")
  }
  await screenshot('03-review', 'review()')
  await narrowScreenshots('03-review')
  await screenshot('04-queued', `tasks = [${task}]; selectedTask = tasks[0].id; currentPage = 'result'; render()`)
  await screenshot('05-running', "tasks[0].state = 'running'; render()")
  if (['geology', 'third-survey', 'planning-review'].includes(site)) {
    const ticking = await evaluate(`(async () => {
      tasks[0].created=Date.now()/1000-65; render()
      const marker=document.querySelector('[data-wait-created]'), before=marker.textContent
      for(let attempt=0;attempt<25 && marker.textContent===before;attempt++) await new Promise(resolve=>setTimeout(resolve,200))
      return document.querySelector('[data-wait-created]')===marker && marker.textContent!==before && marker.textContent.includes('已等待 1 分')
    })()`)
    if (!ticking) throw new Error('GIS elapsed time did not tick without replacing the node')
    await narrowScreenshots('05-running')
  }
  await screenshot('06-failed', "tasks[0].state = 'failed'; tasks[0].error = '测试材料无法读取，请核对文件后重试'; render()")
  if (['geology', 'third-survey', 'planning-review'].includes(site)) {
    if (await evaluate("!!document.querySelector('[data-wait-created]')")) throw new Error('Terminal task retained a waiting-time indicator')
    await narrowScreenshots('06-failed')
  }
  if (['geology', 'third-survey', 'planning-review'].includes(site) && await evaluate("document.querySelector('#main').textContent.includes('等待分析结果')")) throw new Error('Failed GIS task still shows a pending-results prompt')
  if (['geology', 'third-survey', 'planning-review'].includes(site)) {
    const manualRefresh = await evaluate(`(async () => {
      const original=window.fetch; let requests=0
      window.fetch=async path => { if(path==='/api/tasks'){requests++; return new Response(JSON.stringify({items:tasks}), {headers:{'content-type':'application/json'}})} return original(path) }
      try {
        const button=document.querySelector('[data-refresh-result]'); button.click(); button.click()
        for(let i=0;i<100 && resultRefreshing;i++) await new Promise(resolve=>setTimeout(resolve,10))
        const icon=document.querySelector('.gis-result-banner>img'); await icon.decode()
        return requests===1 && !resultRefreshing && !document.querySelector('[data-refresh-result]').disabled && icon.naturalWidth>0
      } finally {window.fetch=original}
    })()`)
    if (!manualRefresh) throw new Error('GIS manual refresh button or copied state icon failed')
  }
  await screenshot('07-success', `tasks[0].state = 'succeeded'; tasks[0].error = ''; tasks[0].outputs = [${JSON.stringify(fixture.output)}]; render()`)
  await narrowScreenshots('07-success')
  if (['geology', 'third-survey', 'planning-review'].includes(site)) {
    await screenshot('07b-structured-results', `analysisSummaries.set(tasks[0].id, {title:'本地视觉测试成果（非生产结论）',datasets:[{name:'测试数据集',records:[[{label:'地块名称',value:'测试范围'},{label:'面积（服务原值）',value:'12.34'},{label:'说明',value:'仅用于检查字段排版与长文本换行，不提供实际分析结论。'}]]},{name:'空数据集',records:[]}]}); render()`)
    await screenshot('07c-expanded-details', "document.querySelector('.task-details').open = true")
    const gisInterpretation = {text:['## 综合结论','- **测试数据**仅用于视觉检查，不是生产结论。','## 关键发现','1. 核对实际标题、段落和完整回答展开区域。','## 数据限制','空图层不能证明不存在风险。'].join('\n'),model_generated:true}
    await screenshot('07c-model-interpretation', `analysisSummaries.get(tasks[0].id).interpretation=${JSON.stringify(gisInterpretation)}; render()`)
    if (await evaluate("document.querySelectorAll('.gis-answer-section').length") !== 3) throw new Error('GIS model answer did not retain legacy heading sections')
    await narrowScreenshots('07c-model-interpretation')
    await screenshot('07c-model-full-answer', "document.querySelector('.gis-answer details').open=true; document.querySelector('.gis-answer details').scrollIntoView({block:'center'})")
    const retainedDetails = await evaluate(`(() => { const main=document.querySelector('#main'); main.scrollTop=180; const before=main.scrollTop; render(); return document.querySelector('.task-details').open && Math.abs(main.scrollTop-before)<2 })()`)
    if (!retainedDetails) throw new Error('GIS result refresh lost the expanded details or reading position')
    await screenshot('07d-cancelled', "tasks[0].state='cancelled'; render()")
    if (await evaluate("document.querySelector('#main').textContent.includes('等待分析结果')")) throw new Error('Cancelled GIS task still shows a pending-results prompt')
  }
  await screenshot('08-history', "currentPage = 'history'; render()")
  await screenshot('09-files', "currentPage = 'files'; render()")
  await screenshot('10-guide', "currentPage = 'guide'; render()")
  await screenshot('11-empty-history', "tasks = []; currentPage = 'history'; render()")
  if (site === 'file-conversion') {
    for (const page of ['history', 'files']) {
      await evaluate(`currentPage='${page}'; render(); document.querySelector('#main .conversion-empty button').click()`)
      if (await evaluate("currentPage !== 'form' || selectedTool.id !== 'word-pdf' || !document.querySelector('#upload')")) throw new Error('Empty-state action did not open the first tool')
    }
    await screenshot('11b-empty-files', "currentPage='files'; render()")
    await narrowScreenshots('11b-empty-files')
  }
  if (site === 'document-processing') {
    for (const page of ['history', 'files']) {
      await evaluate(`currentPage='${page}'; render(); document.querySelector('#main .doc-empty button').click()`)
      if (await evaluate("currentPage !== 'form' || selectedTool.id !== 'summary' || !document.querySelector('#upload')")) throw new Error('Document empty-state action did not open summary preparation')
    }
    await screenshot('11b-empty-files', "currentPage='files'; render()")
    await narrowScreenshots('11b-empty-files')
    await screenshot('12-compare-upload', "form(tools[1]); setComparisonFile(0, [{name:'基准方案.docx',size:2048}]); setComparisonFile(1,[{name:'修订方案.docx',size:3072}])")
    if (await evaluate("!document.querySelector('[data-param=scope]') || !document.querySelector('[data-param=requirements]')")) throw new Error('Comparison scope or supplementary requirements are missing')
    await evaluate("options.scope='数字变化、日期变化'; options.requirements='核对预算和截止时间'; form(selectedTool,true)")
    if (await evaluate("document.querySelector('#dropzone').getBoundingClientRect().height !== 0")) throw new Error('Comparison page exposes the summary uploader')
    const pickers = await evaluate(`(() => {
      const opened = []
      for (const index of [0, 1]) {
        const input = document.querySelector('#version-file-' + index)
        const original = input.click
        input.click = () => opened.push(index)
        document.querySelector('[data-version-pick="' + index + '"]').click()
        input.click = original
      }
      return opened
    })()`)
    if (JSON.stringify(pickers) !== '[0,1]') throw new Error('Comparison buttons did not open their own version picker')
    await narrowScreenshots('12-compare-upload')
    await screenshot('13-compare-review', 'review()')
    if (await evaluate("!document.querySelector('#main').textContent.includes('核对预算和截止时间')")) throw new Error('Comparison requirements were lost before confirmation')
    await narrowScreenshots('13-compare-review')
    await screenshot('14-compare-result', `tasks = [${task}]; selectedTask = tasks[0].id; tasks[0].tool = 'compare'; tasks[0].state = 'succeeded'; tasks[0].outputs = ['文档差异.json']; resultPreviews.set(tasks[0].id, { counts: { added:1, deleted:0, modified:1, unchanged:2 }, changes:[{type:'modified',old:['原方案内容'],new:['修订方案内容']},{type:'added',old:[],new:['新增说明']}] }); currentPage='result'; render()`)
    const comparisonAnalysis = { text: ['## 数字变化', '仅用于视觉检查的测试正文，不是实际模型结论。', '## 日期变化', '检查重点分析与精确差异分开展示。'].join('\n'), model_generated: true }
    await screenshot('14b-compare-analysis', `tasks[0].inputs=['基准方案.docx','修订方案.docx']; tasks[0].input_names=tasks[0].inputs; resultPreviews.get(tasks[0].id).analysis=${JSON.stringify(comparisonAnalysis)}; render()`)
    if (await evaluate("!document.querySelector('#main').textContent.includes('重点变化分析（模型生成）') || !document.querySelector('.doc-diff-stats')")) throw new Error('Model analysis replaced exact comparison statistics')
    await narrowScreenshots('14b-compare-analysis')
    await screenshot('14c-compare-analysis-body', "Array.from(document.querySelectorAll('.doc-result-body h2')).find(node=>node.textContent==='重点变化分析（模型生成）').scrollIntoView({block:'start'})")
    const summaryPreview = { text: ['# 文档摘要与要点', '## 综合摘要', '这是仅用于视觉检查的测试正文。', '## 核心观点', '检查实际标题的分块布局。', '## 风险与问题', '不提供生产任务结论。'].join('\n'), truncated: false }
    await screenshot('15-summary-result', `tasks[0].tool = 'summary'; tasks[0].outputs = ['文档摘要与要点.md']; resultPreviews.set(tasks[0].id, ${JSON.stringify(summaryPreview)}); render()`)
    if (await evaluate("document.querySelectorAll('.doc-summary-sections > section').length") !== 4) throw new Error('Summary fixture did not retain the legacy title block and three level-two sections')
  }
  if (site === 'file-conversion') {
    for (const [id, names] of [['pdf-images',['材料.pdf']],['pdf-organize',['第一份.pdf','第二份.pdf']],['images-pdf',['图片1.jpg','图片2.png']],['image-optimize',['图片.jpg']]]) {
      await screenshot(`${id}-prepare`, `form(tools.find(tool => tool.id === ${JSON.stringify(id)})); selectedFiles=${JSON.stringify(names.map(name => ({name,size:2048})))}; updateFileList()`)
      await narrowScreenshots(`${id}-prepare`)
      await screenshot(`${id}-review`, 'review()')
      await narrowScreenshots(`${id}-review`)
      const outputs = {
        'pdf-images': ['第001页.png', '第002页.png'],
        'pdf-organize': ['合并结果.pdf'],
        'images-pdf': ['图片合成.pdf'],
        'image-optimize': ['图片-001.webp'],
      }[id]
      const conversionTask = {
        id: 'b'.repeat(32), tool: id, options: { ...await evaluate('options'), taskName: '本地视觉测试任务（非生产成果）' },
        inputs: names, input_names: names, created: 1790388000, state: 'running', outputs: [],
      }
      await screenshot(`${id}-running`, `tasks=[${JSON.stringify(conversionTask)}]; selectedTask=tasks[0].id; currentPage='result'; render()`)
      if (await evaluate("document.querySelectorAll('#main a[download]').length")) throw new Error(`${id} exposes unfinished downloads`)
      await screenshot(`${id}-failed`, "tasks[0].state='failed'; tasks[0].error='本地视觉测试：文件无法读取，请核对材料后重试'; render()")
      await screenshot(`${id}-success`, `tasks[0].state='succeeded'; tasks[0].error=''; tasks[0].outputs=${JSON.stringify(outputs)}; render()`)
      await narrowScreenshots(`${id}-success`)
      if (await evaluate("document.querySelectorAll('#main a[download]').length") !== outputs.length) throw new Error(`${id} lost an artifact download`)
      if (['images-pdf', 'image-optimize'].includes(id)) {
        await screenshot(`${id}-thumbnails`, `(async () => {
          form(tools.find(tool => tool.id === ${JSON.stringify(id)}))
          const canvas = document.createElement('canvas'); canvas.width=160; canvas.height=100
          const drawing = canvas.getContext('2d'); drawing.fillStyle='#dbe9ff'; drawing.fillRect(0,0,160,100)
          drawing.fillStyle='#3476eb'; drawing.fillRect(25,20,110,60)
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
          selectedFiles=[new File([blob], '本地预览测试.png', {type:'image/png'})]; updateFileList()
          await Promise.all(Array.from(document.querySelectorAll('.file-preview')).map(image => image.decode()))
        })()`)
        if (!await evaluate("Array.from(document.querySelectorAll('.file-preview')).every(image => image.naturalWidth > 0) && document.querySelectorAll('.file-preview').length === 1")) throw new Error('Local image thumbnail did not decode')
        await narrowScreenshots(`${id}-thumbnails`)
      }
    }
  }
  socket.close()
  process.stdout.write(`Local screenshots for ${site}: ${outputDirectory}\n`)
} finally { chrome.kill() }
