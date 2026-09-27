const tools = [
 { id: 'analysis', name: '土地利用规划审查', description: '读取面范围，调用专业 GIS 分析服务，生成 Word 报告和 Excel 明细。', accept: '.geojson,.json,.zip,.shp,.shx,.dbf,.prj,.cpg', multiple: true,
   params: [['title', '项目名称', null, ''], ['coordinateSystem', '坐标系说明（不自动转换）', null, ''], ['category', '审查类别', null, '4']] },
]
const main = document.querySelector('#main')
let currentPage = 'home', selectedTool, selectedFiles = [], options = {}, tasks = [], timer, toastTimer, busy = false
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
let sessionExpired = false
let progressTimer
function showExpiredSession() {
  main.innerHTML = '<section class="panel"><h1>登录已失效</h1><p>请关闭当前 Tab，从桌面专家库重新打开。</p></section>'
}
function expireSession() {
  sessionExpired = true
  clearInterval(timer)
  clearInterval(progressTimer)
  tasks = []; selectedFiles = []; options = {}
  analysisSummaries.clear()
  showExpiredSession()
}
async function authenticatedFetch(path, options) {
  if (sessionExpired) throw new Error('登录已失效，请重新打开工作台')
  const response = await fetch(path, options)
  if (response.status === 401) expireSession()
  if (sessionExpired) throw new Error('登录已失效，请重新打开工作台')
  return response
}
async function api(path, body) {
  if (sessionExpired) throw new Error('登录已失效，请重新打开工作台')
  const response = await authenticatedFetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (response.status === 401) expireSession()
  const data = await response.json()
  if (sessionExpired) throw new Error('登录已失效，请重新打开工作台')
  if (!response.ok) throw new Error(data.error || '请求失败')
  return data
}
function toast(message) {
  const node = document.querySelector('#toast')
  node.textContent = message; node.hidden = false
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.hidden = true }, 4000)
}
function taskCards(items) {
  const states = { queued: '等待处理', running: '正在处理', succeeded: '已完成', failed: '处理失败', cancelled: '已取消' }
  return items.length ? items.map(task => `<article class="task"><h3>${escape(tools.find(tool => tool.id === task.tool)?.name || task.tool)}</h3><small class="muted">${escape(new Date(task.created * 1000).toLocaleString())}</small><p class="${escape(task.state)}">${escape(states[task.state] || task.state)}</p>${task.error ? `<p class="error">${escape(task.error)}</p>` : ''}${task.state === 'succeeded' ? task.outputs.map((name, index) => `<a href="/api/tasks/${task.id}/files/${index}" download>${escape(name)}</a>`).join('') : ''}${['queued', 'running'].includes(task.state) ? `<button class="secondary" data-cancel="${task.id}">取消任务</button>` : ''}</article>`).join('') : '<p class="empty">暂无任务，选择一个工具开始处理。</p>'
}
let selectedTask, listQuery = '', historyFilter = 'all', fileFilter = 'all'
const analysisSummaries = new Map()
const stateLabels = { queued: '等待处理', running: '正在处理', succeeded: '已完成', failed: '处理失败', cancelled: '已取消' }
function toolIcon(id) {
  return '/assets/expert.png'
}
function historyMarkup() {
  return tasks.length ? `<div class="history-list">${tasks.map(task => `<button class="history-row" data-task="${escape(task.id)}"><img src="${toolIcon(task.tool)}" alt=""><span><strong>${escape(task.options.taskName || task.options.title || tools.find(tool => tool.id === task.tool)?.name || task.tool)}</strong><small>${escape(new Date(task.created * 1000).toLocaleString())} · ${task.inputs.length} 个文件</small></span><em class="${escape(task.state)}">${escape(stateLabels[task.state] || task.state)}</em></button>`).join('')}</div>` : '<p class="empty">暂无处理记录，选择一个工具开始处理。</p>'
}
function filesMarkup() {
  const files = tasks.filter(task => task.state === 'succeeded').flatMap(task => task.outputs.map((name, index) => ({ task, name, index })))
  return files.length ? `<div class="outputs">${files.map(({ task, name, index }) => `<div><span><strong>${escape(name)}</strong><small>${escape(task.options.taskName || task.options.title || tools.find(tool => tool.id === task.tool)?.name || task.tool)}</small></span><a class="primary" href="/api/tasks/${escape(task.id)}/files/${index}" download>下载文件</a></div>`).join('')}</div>` : '<p class="empty">暂无成果文件，任务完成后可在这里下载。</p>'
}
function overviewMarkup() {
  const matching = value => value.toLocaleLowerCase().includes(listQuery.toLocaleLowerCase())
  const counts = currentPage === 'history'
    ? [['全部记录', tasks.length], ['分析中', tasks.filter(task => ['queued', 'running'].includes(task.state)).length], ['已完成', tasks.filter(task => task.state === 'succeeded').length], ['未完成', tasks.filter(task => ['failed', 'cancelled'].includes(task.state)).length]]
    : [['成果文件', tasks.filter(task => task.state === 'succeeded').flatMap(task => task.outputs).length], ['Word 报告', tasks.filter(task => task.state === 'succeeded').flatMap(task => task.outputs).filter(name => /\.docx$/i.test(name)).length], ['Excel 明细', tasks.filter(task => task.state === 'succeeded').flatMap(task => task.outputs).filter(name => /\.xlsx$/i.test(name)).length]]
  const filters = currentPage === 'history' ? [['all','全部'],['running','分析中'],['succeeded','已完成'],['failed','未完成']] : [['all','全部'],['docx','Word 报告'],['xlsx','Excel 明细'],['json','JSON']]
  const selected = currentPage === 'history' ? historyFilter : fileFilter
  const toolbar = `<div class="list-toolbar"><label>搜索${currentPage === 'history' ? '项目' : '成果'}<input id="list-search" value="${escape(listQuery)}" placeholder="输入项目名称或文件名"></label><div class="filter-group">${filters.map(([value, label]) => `<button data-filter="${value}" aria-pressed="${selected === value}">${label}</button>`).join('')}</div></div>`
  const rows = currentPage === 'history'
    ? tasks.filter(task => matching(task.options.taskName || task.options.title || tools.find(tool => tool.id === task.tool)?.name || task.tool) && (historyFilter === 'all' || (historyFilter === 'running' ? ['queued','running'].includes(task.state) : historyFilter === 'failed' ? ['failed','cancelled'].includes(task.state) : task.state === historyFilter)))
    : tasks.filter(task => task.state === 'succeeded').flatMap(task => task.outputs.map((name, index) => ({ task, name, index }))).filter(({ task, name }) => (fileFilter === 'all' || name.toLowerCase().endsWith('.' + fileFilter)) && matching(`${name} ${task.options.taskName || task.options.title || ''}`))
  const list = currentPage === 'history'
    ? rows.map(task => `<button class="history-row" data-task="${escape(task.id)}"><img src="${toolIcon(task.tool)}" alt=""><span><strong>${escape(task.options.taskName || task.options.title || tools.find(tool => tool.id === task.tool)?.name || task.tool)}</strong><small>${escape(new Date(task.created * 1000).toLocaleString())}</small></span><em class="${escape(task.state)}">${escape(stateLabels[task.state] || task.state)}</em></button>`).join('')
    : rows.map(({ task, name, index }) => `<div><span><strong>${escape(name)}</strong><small>${escape(task.options.taskName || task.options.title || task.tool)}</small></span><a class="primary" href="/api/tasks/${escape(task.id)}/files/${index}" download>下载文件</a></div>`).join('')
  return `<h1>${currentPage === 'history' ? '我的分析记录' : '我的成果文件'}</h1><p class="muted">仅展示当前用户在本专家服务中的真实任务与成果。</p><div class="stat-strip">${counts.map(([label, count]) => `<span><b>${count}</b><small>${label}</small></span>`).join('')}</div>${toolbar}<div class="${currentPage === 'history' ? 'history-list' : 'outputs'}">${list || '<p class="empty">没有符合搜索或筛选条件的内容。</p>'}</div>`
}
function waitingDuration(created, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - created * 1000) / 1000))
  return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`
}
function spatialProgress(created) {
  return `<div class="gis-live-progress" role="status" aria-live="off"><span class="gis-spinner" aria-hidden="true"></span><span data-wait-created="${created}">任务仍在运行 · 已等待 ${waitingDuration(created)}</span><small>页面会自动读取结果；耗时取决于数据和模型处理，不代表固定完成进度。</small></div>`
}
function updateWaitingDuration() {
  if (sessionExpired) return
  main.querySelectorAll('[data-wait-created]').forEach(node => {
    node.textContent = `任务仍在运行 · 已等待 ${waitingDuration(Number(node.dataset.waitCreated))}`
  })
}
function taskMarkup() {
  const task = tasks.find(item => item.id === selectedTask)
  if (!task) return '<h1>任务暂不可用</h1><p class="muted">记录可能已超过保留期限，请返回任务记录查看。</p>'
  const tool = tools.find(item => item.id === task.tool)
  const success = task.state === 'succeeded', active = ['queued', 'running'].includes(task.state)
  const name = escape(task.options.taskName || task.options.title || tool?.name || task.tool)
  const banner = `<section class="gis-result-banner ${success ? 'complete' : active ? 'active' : 'incomplete'}"><img src="/assets/${success ? 'success' : active ? 'running' : 'failed'}.png" alt=""><div><h2>${success ? '分析已完成' : active ? task.state === 'queued' ? '等待分析' : '正在分析项目范围' : task.state === 'cancelled' ? '分析已取消' : '分析未完成'}</h2><p>${success ? '请核对本次服务返回的数据和实际生成的成果文件。' : active ? '任务已提交，可以切换到分析记录，任务会继续运行。' : '本次没有可下载成果，请核对材料后新建分析。'}</p>${active ? spatialProgress(task.created) : ''}</div></section>`
  const outputs = success ? `<section class="panel gis-result-outputs"><h2>本次成果文件 <small>${task.outputs.length} 个</small></h2><div>${task.outputs.map((file,index) => `<a href="/api/tasks/${escape(task.id)}/files/${index}" download><span class="gis-file-glyph" aria-hidden="true">${/\.docx$/i.test(file) ? 'W' : /\.xlsx$/i.test(file) ? 'X' : 'J'}</span><span><strong>${escape(file)}</strong><small>${/\.docx$/i.test(file) ? 'Word 报告' : /\.xlsx$/i.test(file) ? 'Excel 明细' : '数据文件'} · 下载文件</small></span></a>`).join('') || '<p class="muted">本次没有发布成果文件。</p>'}</div></section>` : ''
  return `<header class="gis-result-heading"><div><span>${escape(tool?.name || task.tool)} · 分析任务</span><h1>${name}</h1><p class="muted">创建于 ${escape(new Date(task.created * 1000).toLocaleString())}，结果和文件均来自本次任务。</p></div><div class="gis-result-heading-actions"><button class="secondary" data-refresh-result ${resultRefreshing ? 'disabled' : ''}>${resultRefreshing ? '正在刷新…' : '刷新结果'}</button><button class="secondary" data-page="history">返回分析记录</button></div></header><div class="stepbar"><span>✓ 准备材料</span><span>✓ 核对信息</span><span class="current">3 分析与交付</span></div><div class="gis-result-layout"><div class="gis-result-body">${banner}${task.error ? `<section class="panel gis-result-error"><h2>未完成的原因</h2><p class="error">${escape(task.error)}</p></section>` : ''}${success ? summaryMarkup(task) : `<section class="panel"><h2>${active ? '等待分析结果' : '本次没有可展示的分析结果'}</h2><p class="muted">${active ? '仅显示真实服务状态，不展示示例结论。' : '任务已经结束，请核对状态和原因后重新创建分析。'}</p></section>`}${outputs}${active ? `<div class="actions"><button class="secondary" data-cancel="${escape(task.id)}">取消任务</button></div>` : !success && tool ? `<div class="actions"><button class="primary" data-tool="${escape(tool.id)}">重新创建分析</button></div>` : ''}</div><aside class="gis-result-aside"><section class="panel"><h2>任务信息</h2><dl class="review"><dt>项目名称</dt><dd>${name}</dd><dt>当前状态</dt><dd>${escape(stateLabels[task.state] || task.state)}</dd></dl></section><details class="panel task-details"><summary>任务详情与输入参数</summary><dl class="review"><dt>创建时间</dt><dd>${escape(new Date(task.created * 1000).toLocaleString())}</dd><dt>输入文件</dt><dd>${(task.input_names?.length ? task.input_names : task.inputs).map(name => escape(name)).join('<br>')}</dd>${(tool?.params || []).map(([key, label]) => `<dt>${escape(label)}</dt><dd>${escape(task.options[key] || '未填写')}</dd>`).join('')}</dl></details><section class="panel"><h2>查看与继续</h2><p class="muted">任务及成果保存在当前专家服务中，仅当前用户可访问。</p><button class="secondary" data-page="history">查看我的分析记录</button></section></aside></div>`
}
function interpretationMarkup(value) {
  if (typeof value.interpretation?.text !== 'string') return ''
  const text = value.interpretation.text
  const sections = []
  let current
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const heading = /^#{1,3}\s+(.+)$/.exec(line)
    if (heading) {
      current = { heading: heading[1].replace(/\*\*/g, ''), body: [] }
      sections.push(current)
    } else if (current && line && !/^\|(?:\s*[-:]+\s*\|)+$/.test(line)) current.body.push(line)
  }
  const useful = sections.filter(section => section.body.length && !/原始返回|原始数据|生成文件|交付文件|成果文件/.test(section.heading))
  const body = useful.length ? useful.map(section => `<div class="gis-answer-section"><h4>${escape(section.heading)}</h4>${section.body.filter(line => !/^\|/.test(line) && !/[A-Z]:\\.*\.(?:json|md|docx|xlsx)/i.test(line)).map(line => `<p>${escape(line.replace(/^(?:[-*•]|\d+\.)\s+/, '').replace(/\*\*/g, ''))}</p>`).join('')}</div>`).join('')
    : '<p>本次回答没有可单独提取的结论，请展开原始回答核对。</p>'
  return `<section class="gis-answer"><h3>综合解读（模型生成）</h3>${body}<details><summary>查看完整模型回答（含原始数据与文件清单）</summary><pre>${escape(text)}</pre></details><p class="muted">解读依据本次服务数据生成，不改变接口统计；重要判断请由专业人员核对。</p></section>`
}
function summaryMarkup(task) {
  const value = analysisSummaries.get(task.id)
  if (value === undefined) return '<section class="panel analysis-summary"><h2>分析结果</h2><p class="muted">正在读取本次任务生成的数据…</p></section>'
  if (value === null) return '<section class="panel analysis-summary"><h2>分析结果</h2><p class="error">无法读取结构化结果，请下载实际生成的报告与 JSON 核对。</p></section>'
  return `${interpretationMarkup(value)}<section class="panel analysis-summary"><h2>${escape(value.title || '分析结果')}</h2><p class="muted">仅展示服务返回的数据，不根据空数据集推断不存在风险。面积单位沿用服务原值，需向提供方核对。</p>${value.datasets.map(dataset => `<div class="analysis-dataset"><h3>${escape(dataset.name)} <small>${dataset.records.length} 条</small></h3>${dataset.records.length ? dataset.records.slice(0, 100).map((fields, index) => `<div class="analysis-record"><strong>记录 ${index + 1}</strong><dl>${fields.map(field => `<dt>${escape(field.label)}</dt><dd>${escape(field.value)}</dd>`).join('')}</dl></div>`).join('') : '<p class="muted">当前数据集未返回记录。</p>'}${dataset.records.length > 100 ? '<p class="muted">这里只显示前 100 条；完整内容请下载 Excel 或 JSON 成果。</p>' : ''}</div>`).join('')}</section>`
}
async function loadSummary(task) {
  if (task?.state !== 'succeeded' || analysisSummaries.has(task.id)) return
  const index = task.outputs.indexOf('分析结果.json')
  if (index < 0) { analysisSummaries.set(task.id, null); render(); return }
  analysisSummaries.set(task.id, undefined)
  try {
    const response = await authenticatedFetch(`/api/tasks/${encodeURIComponent(task.id)}/files/${index}`)
    if (!response.ok || Number(response.headers.get('content-length')) > 16 * 1024 * 1024) throw new Error('result unavailable')
    const raw = await response.text()
    if (sessionExpired) return
    if (raw.length > 16 * 1024 * 1024) throw new Error('result too large')
    const value = JSON.parse(raw)
    if (!value || !Array.isArray(value.datasets) || value.datasets.some(dataset => typeof dataset.name !== 'string' || !Array.isArray(dataset.records) || dataset.records.some(fields => !Array.isArray(fields) || fields.some(field => typeof field.label !== 'string' || typeof field.value !== 'string')))) throw new Error('invalid result')
    analysisSummaries.set(task.id, value)
  } catch { if (!sessionExpired) analysisSummaries.set(task.id, null) }
  if (currentPage === 'result' && selectedTask === task.id) render()
}
function homeMarkup() {
  return `<div class="dashboard spatial-home"><section class="hero"><span>土地利用规划审查专家</span><h1>土地利用规划审查专家</h1><p class="home-subhead">规划符合性与用途管制审查</p><div class="home-actions"><button class="primary" data-tool="analysis">＋ 新建分析</button><button class="secondary" data-page="guide">查看使用说明</button></div></section><section class="capabilities"><h3>能力说明</h3><p>✓ 支持 GeoJSON 和完整 Shape 范围数据</p><p>✓ 审查规划图层关系与用途管制要求</p><p>✓ 查看本次任务实际生成的 Word 报告和 Excel 明细</p></section><section class="steps"><h3>接下来可以做什么？</h3><div><span><b>1</b><strong>准备数据</strong><small>整理项目地块的范围文件</small></span><span><b>2</b><strong>新建分析</strong><small>上传文件并核对信息</small></span><span><b>3</b><strong>查看任务</strong><small>读取运行状态与真实成果</small></span></div></section><section class="home-recent"><header><div><h3>最近的分析记录</h3><p>这里展示当前用户在本专家服务中的任务。</p></div>${tasks.length ? '<button data-page="history">查看全部</button>' : ''}</header>${tasks.length ? historyMarkup() : '<div class="home-recent-empty"><svg class="ui-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><strong>暂无分析记录</strong><small>点击“新建分析”开始第一次分析。</small></div>'}</section></div>`
}
function updateNavigation() {
  const page = currentPage === 'form' ? 'home' : currentPage === 'result' ? 'history' : currentPage
  document.querySelectorAll('aside [data-page]').forEach(node => node.classList.toggle('active', node.dataset.page === page))
}
let renderedTask
function render() {
  if (sessionExpired) { showExpiredSession(); return }
  const keepDetailsOpen = currentPage === 'result' && renderedTask === selectedTask && document.querySelector('.task-details')?.open === true
  const readingPosition = main.scrollTop
  updateNavigation()
  if (currentPage === 'home') main.innerHTML = homeMarkup()
  if (currentPage === 'history' || currentPage === 'files') main.innerHTML = overviewMarkup()
  if (currentPage === 'result') { main.innerHTML = taskMarkup(); void loadSummary(tasks.find(task => task.id === selectedTask)) }
  if (currentPage === 'guide') main.innerHTML = '<div class="guide-page"><button class="text-action" data-page="home">← 返回首页</button><section class="guide-hero"><span class="eyebrow">使用指南</span><h1>从项目范围开始，核对规划要求</h1><p>准备材料，核对提交信息，查看处理结果并下载成果。</p><button class="primary" data-tool="analysis">＋ 新建任务</button></section><div class="guide-grid"><section class="panel"><span>01 / 准备范围</span><h2>准备范围</h2><p>选择一个 GeoJSON、JSON、Shape ZIP 或完整 Shape 文件组。Shape 至少包含同名 shp、shx、dbf，可附 prj 和 cpg。仅支持闭合面范围。</p></section><section class="panel"><span>02 / 提交前核对</span><h2>提交前核对</h2><p>核对所选文件、任务名称和处理选项，再确认提交。任务进度、记录与成果均可在当前专家工作台查看。</p></section><section class="panel"><span>03 / 坐标与分析</span><h2>坐标与分析</h2><p>保留输入原始坐标，不自动投影。提交前请核对坐标系与 GIS 服务要求一致。接口地址由专家服务器配置。</p></section><section class="panel"><span>04 / 成果复核</span><h2>成果复核</h2><p>成果包含 Word、Excel、原始 JSON 与中文结果 JSON。各图层独立面积口径不可相加；单位须向服务提供方核对。空数据集不能解释为不存在风险。</p></section></div></div>'
  bind()
  if (currentPage === 'result') {
    const details = document.querySelector('.task-details')
    if (details) details.open = keepDetailsOpen
    if (renderedTask === selectedTask) main.scrollTop = readingPosition
    renderedTask = selectedTask
  } else renderedTask = undefined
}
let resultRefreshing = false
async function refreshResult() {
  if (resultRefreshing) return
  const taskId = selectedTask
  resultRefreshing = true
  const button = document.querySelector('[data-refresh-result]')
  if (button) button.disabled = true
  try {
    const items = await fetchLatestTasks()
    if (items === null) return
    tasks = items
    analysisSummaries.delete(taskId)
    if (currentPage === 'result') render()
  } catch (error) { toast(error.message || '结果刷新失败，请重试') }
  finally {
    resultRefreshing = false
    const next = document.querySelector('[data-refresh-result]')
    if (next) { next.disabled = false; next.textContent = '刷新结果' }
  }
}
function bind() {
  const refreshButton = document.querySelector('[data-refresh-result]')
  if (refreshButton) refreshButton.onclick = () => { void refreshResult() }
  main.querySelectorAll('a[download]').forEach(link => {
    if (typeof window.__ZJUGIS_NATIVE_INVOKE__ !== 'function') return
    link.onclick = async event => {
      event.preventDefault()
      if (link.dataset.saving === 'true') return
      link.dataset.saving = 'true'
      try { await saveArtifact(link); toast('成果已保存到下载目录') }
      catch (error) { toast(error.message || '成果保存失败，请重试') }
      finally { link.dataset.saving = 'false' }
    }
  })
  main.querySelectorAll('[data-task]').forEach(node => node.onclick = () => { selectedTask = node.dataset.task; currentPage = 'result'; render() })
  const search = document.querySelector('#list-search')
  if (search) search.oninput = () => { listQuery = search.value; const position = search.selectionStart; render(); const next = document.querySelector('#list-search'); next?.focus(); if (position !== null) next?.setSelectionRange(position, position) }
  main.querySelectorAll('[data-filter]').forEach(node => node.onclick = () => { if (currentPage === 'history') historyFilter = node.dataset.filter; else fileFilter = node.dataset.filter; render() })
  main.querySelectorAll('[data-page]').forEach(node => node.onclick = () => { currentPage = node.dataset.page; render() })
  main.querySelectorAll('[data-tool]').forEach(node => node.onclick = () => form(tools.find(tool => tool.id === node.dataset.tool)))
  main.querySelectorAll('[data-cancel]').forEach(node => node.onclick = async () => { try { await api(`/api/tasks/${node.dataset.cancel}/cancel`, {}); await refresh(); toast('任务已取消') } catch (error) { toast(error.message) } })
}
async function saveArtifact(link) {
  const response = await authenticatedFetch(link.getAttribute('href'))
  if (!response.ok) throw new Error('成果下载失败，请重新打开任务')
  const disposition = response.headers.get('content-disposition') || ''
  const encodedName = /^attachment; filename\*=UTF-8''(.+)$/i.exec(disposition)?.[1]
  if (!encodedName) throw new Error('成果文件名无效')
  const fileName = decodeURIComponent(encodedName)
  const limit = 128 * 1024 * 1024
  if (Number(response.headers.get('content-length')) > limit) throw new Error('成果超过 128 MB，无法保存')
  const reader = response.body.getReader(), chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (sessionExpired) { await reader.cancel(); throw new Error('登录已失效，请重新打开工作台') }
      if (done) break
      total += value.byteLength
      if (total > limit) { await reader.cancel(); throw new Error('成果超过 128 MB，无法保存') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  if (!total) throw new Error('成果文件为空')
  if (sessionExpired) throw new Error('登录已失效，请重新打开工作台')
  const bytesBase64 = await new Promise((resolve, reject) => {
    const file = new FileReader()
    file.onload = () => resolve(String(file.result).split(',')[1])
    file.onerror = () => reject(new Error('成果读取失败'))
    file.readAsDataURL(new Blob(chunks))
  })
  if (sessionExpired) throw new Error('登录已失效，请重新打开工作台')
  await window.__ZJUGIS_NATIVE_INVOKE__('save_expert_artifact', { fileName, bytesBase64 })
}
// Legacy TerrainIllustration.tsx copy: decorative, not uploaded parcel or result data.
function terrainMarkup() {
  return '<svg class="gis-terrain" viewBox="0 0 560 190" fill="none" aria-hidden="true" focusable="false"> <path d="M0 163 83 132 129 46 182 132 268 65 327 136 414 33 478 126 560 31v159H0Z" fill="currentColor" opacity=".08" /> <path d="M-24 151 C56 143 74 109 129 121 S207 179 268 135 S350 67 414 103 S501 154 590 65" stroke="currentColor" stroke-width="1" opacity=".35" /><path d="M-24 137 C51 128 77 93 129 106 S208 164 268 121 S350 53 414 89 S501 140 590 51" stroke="currentColor" stroke-width="1" opacity=".35" /><path d="M-24 123 C49 113 80 77 129 91 S210 149 268 107 S350 39 414 75 S502 126 590 37" stroke="currentColor" stroke-width="1.6" opacity=".64" /><path d="M-24 109 C46 98 82 62 129 76 S211 134 268 93 S350 25 414 61 S503 112 590 23" stroke="currentColor" stroke-width="1" opacity=".35" /><path d="M-24 95 C44 83 84 47 129 61 S212 119 268 79 S350 11 414 47 S504 98 590 9" stroke="currentColor" stroke-width="1" opacity=".35" /><path d="M-24 81 C42 68 86 32 129 46 S214 104 268 65 S350 -3 414 33 S505 84 590 -5" stroke="currentColor" stroke-width="1" opacity=".35" /> <path d="M0 173h560M0 148h560M0 123h560M0 98h560M0 73h560M0 48h560M40 0v190M95 0v190M150 0v190M205 0v190M260 0v190M315 0v190M370 0v190M425 0v190M480 0v190M535 0v190" stroke="currentColor" opacity=".1" /> <circle cx="414" cy="33" r="5" fill="currentColor" /> <path d="M414 42v17" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 3" /> </svg>'
}
function gisParametersMarkup(tool) {
  const hints = {
    coordinateSystem: '例如 CGCS2000；文件有 .prj 时可留空。不自动转换坐标，不能猜测。',
    year: '默认 2024；仅在需要分析其他三调年度时修改。',
    category: '默认 4；仅在业务人员明确指定其他审查类别时修改。',
    zoneField: '默认“分区名称”；仅在源数据使用其他字段时修改。',
  }
  const field = ([key, label, , value]) => `<label>${escape(label)}<input data-param="${escape(key)}" value="${escape(value)}">${hints[key] ? `<small class="parameter-hint">${hints[key]}</small>` : ''}</label>`
  return `<details class="gis-advanced"><summary>高级选项</summary>${tool.params.filter(param => param[0] !== 'title').map(field).join('')}</details>`
}
function form(tool, preserve = false) {
  if (sessionExpired) { showExpiredSession(); return }
  selectedTool = tool
  if (!preserve) {
    selectedFiles = []
    options = Object.fromEntries(tool.params.map(([key,,, value]) => [key, value]))
  }
  currentPage = 'form'
  updateNavigation()
  main.innerHTML = `<h1>${escape(tool.name)}</h1><p class="muted">${escape(tool.description)}</p><div class="stepbar"><span class="current">1 准备文件</span><span>2 确认任务</span><span>3 处理与结果</span></div><div class="formgrid"><section class="panel"><label>项目名称<input id="task-name" maxlength="180" value="${escape(options.title || options.taskName || '')}" placeholder="填写项目名称，便于识别分析记录和报告"></label><input id="upload" type="file" hidden accept="${tool.accept}" ${tool.multiple ? 'multiple' : ''}><button type="button" id="dropzone" class="dropzone gis-upload"><img src="/assets/upload.png" alt=""><strong>点击或拖拽文件到此处上传</strong><small>支持 GeoJSON、Shape ZIP，或同名的 .shp / .shx / .dbf 文件</small></button><button type="button" class="secondary" id="append-files">追加文件</button><input type="file" id="append-upload" hidden accept="${tool.accept}" ${tool.multiple ? 'multiple' : ''}><p class="muted">最多 30 个文件，总大小 32 MB。文件按选择顺序处理。</p><div id="filelist" class="filelist"></div>${gisParametersMarkup(tool)}</section><aside class="gis-prepare-aside"><section class="panel"><img src="/assets/upload.png" alt=""><h2>准备地块数据</h2><p>范围应为面或多面。可提交一个 GeoJSON、完整 Shape ZIP，或同名的 .shp / .shx / .dbf 文件组。</p><p>保留输入原始坐标，不自动投影；请核对坐标系与服务要求一致。</p>${terrainMarkup()}</section><section class="panel"><svg class="ui-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/></svg><h2>本专家将交付</h2><ul><li>Word 分析报告</li><li>Excel 明细表</li><li>原始 JSON 与中文结果 JSON</li></ul><p>实际成果以本次任务成功生成的文件为准。</p></section><p class="gis-prepare-note">审查结果用于辅助研判，不替代法定审批和专业审查意见。</p></aside></div><div class="actions"><button class="secondary" id="back">返回</button><button class="primary" id="review">下一步：确认任务</button></div>`
  document.querySelectorAll('[data-param]').forEach(node => { node.value = options[node.dataset.param] ?? '' })
  updateFileList()
  document.querySelector('#upload').onchange = event => {
    selectFiles(event.target.files)
  }
  document.querySelector('#task-name').oninput = event => { options.title = event.target.value; options.taskName = event.target.value }
  document.querySelector('#append-files').onclick = () => document.querySelector('#append-upload').click()
  document.querySelector('#append-upload').onchange = event => { selectFiles(event.target.files, true); event.target.value = '' }
  const dropzone = document.querySelector('#dropzone')
  dropzone.onclick = () => document.querySelector('#upload').click()
  dropzone.ondragover = event => { event.preventDefault(); dropzone.classList.add('dragging') }
  dropzone.ondragleave = event => { if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('dragging') }
  dropzone.ondrop = event => { event.preventDefault(); dropzone.classList.remove('dragging'); selectFiles(event.dataTransfer.files, true) }
  document.querySelectorAll('[data-param]').forEach(node => node.onchange = () => { options[node.dataset.param] = node.value })
  document.querySelector('#back').onclick = () => { currentPage = 'home'; render() }
  document.querySelector('#review').onclick = review
}
function selectFiles(incoming, append = false) {
  const added = Array.from(incoming)
  if (!added.length) return false
  const candidate = append && selectedTool.multiple ? [...selectedFiles, ...added] : added
  if (!selectedTool.multiple && candidate.length !== 1) { toast('这个工具一次只能选择一个文件'); return false }
  if (candidate.length > 30 || candidate.reduce((sum, file) => sum + file.size, 0) > 32 * 1024 * 1024) { toast('最多 30 个文件，总大小不超过 32 MB'); return false }
  const extensions = selectedTool.accept.split(',')
  if (candidate.some(file => !file.size || !extensions.some(extension => file.name.toLowerCase().endsWith(extension)))) {
    toast('文件为空或格式不支持，请按工具要求选择文件')
    return false
  }
  selectedFiles = candidate
  updateFileList()
  return true
}
function moveFile(index, direction) {
  const target = index + direction
  if (!Number.isInteger(index) || ![-1, 1].includes(direction) || index < 0 || index >= selectedFiles.length || target < 0 || target >= selectedFiles.length) return
  ;[selectedFiles[index], selectedFiles[target]] = [selectedFiles[target], selectedFiles[index]]
  updateFileList()
}
function updateFileList() {
  const list = document.querySelector('#filelist')
  list.innerHTML = selectedFiles.map((file, index) => `<div class="file-entry"><span>${index + 1}. ${escape(file.name)} <small class="muted">${(file.size / 1024).toFixed(1)} KB</small></span><div><button type="button" data-up="${index}" aria-label="上移 ${escape(file.name)}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-down="${index}" aria-label="下移 ${escape(file.name)}" ${index === selectedFiles.length - 1 ? 'disabled' : ''}>↓</button><button type="button" data-remove="${index}" aria-label="移除 ${escape(file.name)}">移除</button></div></div>`).join('')
  list.querySelectorAll('[data-up]').forEach(node => node.onclick = () => moveFile(Number(node.dataset.up), -1))
  list.querySelectorAll('[data-down]').forEach(node => node.onclick = () => moveFile(Number(node.dataset.down), 1))
  list.querySelectorAll('[data-remove]').forEach(node => node.onclick = () => {
    selectedFiles.splice(Number(node.dataset.remove), 1)
    updateFileList()
  })
}
function review() {
  if (selectedTool.id === 'analysis') {
    const value = Number(options.category)
    if (!/^[0-9]+$/.test(String(options.category ?? '').trim()) || !Number.isInteger(value) || value < 1 || value > 99) return toast('审查类别须为 1–99 的整数')
  }
  const single = selectedFiles.filter(file => /\.(geojson|json|zip)$/i.test(file.name))
  if (single.length && selectedFiles.length !== 1) return toast('一次请选择一个 GeoJSON 或 Shape ZIP 数据集')
  if (!single.length && !['shp', 'shx', 'dbf'].every(extension => selectedFiles.some(file => file.name.toLowerCase().endsWith('.' + extension)))) return toast('Shape 至少包含 shp、shx、dbf 文件')
  if (!single.length) {
    const stems = new Set(selectedFiles.map(file => file.name.replace(/\.[^.]+$/, '').toLowerCase()))
    const extensions = selectedFiles.map(file => file.name.split('.').pop().toLowerCase())
    if (stems.size !== 1) return toast('Shape 文件必须同名，请选择同一个数据集的 shp、shx、dbf 及附属文件')
    if (new Set(extensions).size !== extensions.length) return toast('Shape 数据集不能重复选择同一种扩展名的文件')
  }
  if (selectedTool.id === 'summary' && selectedFiles.length > 10) return toast('摘要最多选择 10 份文件')
  if (!selectedFiles.length || selectedFiles.length > 30 || selectedFiles.reduce((sum, file) => sum + file.size, 0) > 32 * 1024 * 1024) return toast('请选择 1–30 个文件，总大小不超过 32 MB')
  main.innerHTML = `<h1>核对分析信息</h1><div class="stepbar"><span>1 准备文件</span><span class="current">2 核对信息</span><span>3 分析与成果</span></div><div class="gis-review-layout"><section class="panel gis-review"><h2>请核对这些信息</h2><dl><div><dt>项目名称</dt><dd>${escape(options.title || options.taskName || selectedTool.name)}</dd></div><div><dt>范围文件</dt><dd>${selectedFiles.map(file => escape(file.name)).join('<br>')}</dd></div>${selectedTool.params.filter(param => param[0] !== 'title').map(([key, label]) => `<div><dt>${escape(label)}</dt><dd>${escape(options[key] !== undefined && options[key] !== '' ? options[key] : key === 'coordinateSystem' ? '未填写；输入坐标保持原值，不自动转换' : '未填写')}</dd></div>`).join('')}</dl></section><aside class="gis-review-aside"><strong>运行后将展示</strong><p>本次服务返回的数据集，以及实际生成的 Word、Excel 和 JSON 成果。</p><span>不会展示示例结论或不存在的文件。请确认范围与坐标符合服务要求。</span></aside></div><div class="actions"><button class="secondary" id="return">返回修改</button><button class="primary" id="start">开始分析</button></div>`
  document.querySelector('#return').onclick = () => form(selectedTool, true)
  document.querySelector('#start').onclick = submit
}
async function submit() {
  if (busy) return
  busy = true; document.querySelector('#start').disabled = true
  try {
    const files = await Promise.all(selectedFiles.map(file => new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, content: String(reader.result).split(',')[1] }); reader.onerror = () => reject(new Error('文件读取失败')); reader.readAsDataURL(file)
    })))
    await api('/api/tasks', { tool: selectedTool.id, options, files })
    currentPage = 'history'; await refresh(); toast('任务已提交')
  } catch (error) { toast(error.message); const button = document.querySelector('#start'); if (button) button.disabled = false }
  finally { busy = false }
}
let tasksLoaded = false
let taskRequestSequence = 0
let appliedTaskRequest = 0
async function fetchLatestTasks() {
  const sequence = ++taskRequestSequence
  const items = (await api('/api/tasks')).items
  if (sequence < appliedTaskRequest) return null
  appliedTaskRequest = sequence
  return items
}
async function refresh() {
  const items = await fetchLatestTasks()
  if (items === null) return
  const changed = !tasksLoaded || JSON.stringify(items) !== JSON.stringify(tasks)
  tasks = items
  tasksLoaded = true
  if (changed && currentPage !== 'form') render()
}
document.querySelector('#new').onclick = () => { currentPage = 'home'; render() }
document.querySelectorAll('[data-page]').forEach(node => node.onclick = () => { currentPage = node.dataset.page; render() })
async function boot() {
  try {
    const ticket = new URLSearchParams(location.hash.slice(1)).get('ticket')
    history.replaceState(null, '', location.pathname)
    if (ticket) await api('/api/session', { ticket })
    await refresh()
    timer = setInterval(() => { refresh().catch(error => { clearInterval(timer); toast(error.message) }) }, 2500)
    progressTimer = setInterval(updateWaitingDuration, 1000)
  } catch (error) { main.innerHTML = `<section class="panel"><h1>无法打开工作台</h1><p class="error">${escape(error.message)}</p><p class="muted">请关闭当前 Tab，从桌面专家库重新打开。</p></section>` }
}
window.addEventListener('pagehide', () => { clearInterval(timer); clearInterval(progressTimer) })
boot()
