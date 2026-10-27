const tools = [

  { id: 'redline-extract', name: 'DWG/DXF 红线提取', description: '从图纸中提取闭合红线范围，导出 GeoJSON 或 Shapefile。可指定图层名；留空则匹配含“红线/REDLINE”等关键字的图层。大图建议先在 CAD 另存为 DXF 再上传，DWG 需服务器转换，耗时更长。', accept: '.dwg,.dxf', multiple: false,
    params: [
      ['layer', '图层名（可留空自动匹配）', null, ''],
      ['exportFormat', '导出格式', [['geojson', 'GeoJSON'], ['shp', 'Shapefile ZIP'], ['both', '同时导出']], 'geojson'],
    ] }
]
const main = document.querySelector('#main')
let currentPage = 'home', selectedTool, selectedFiles = [], options = {}, tasks = [], timer, toastTimer, busy = false
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
function parameterText(tool, key, values, raw) {
  if (raw === undefined || raw === null || raw === '') return '未填写'
  const entry = values?.find(value => String(Array.isArray(value) ? value[0] : value) === String(raw))
  return Array.isArray(entry) ? entry[1] : String(raw)
}
function expectedOutputs(tool, values) {
  switch (tool.id) {
    case 'coordinate-transform': return '1 个转换后的 CSV 坐标表'
    case 'format-convert': return values.targetFormat === 'dxf' ? 'DXF 或 ZIP 成果' : `转换为 ${String(values.targetFormat).toUpperCase()} 的 ZIP 成果`
    case 'redline-extract': return values.exportFormat === 'both' ? 'GeoJSON 与 Shapefile ZIP' : values.exportFormat === 'shp' ? 'Shapefile ZIP' : 'GeoJSON 红线范围'
    default: return '处理完成后显示实际生成的文件'
  }
}
let sessionExpired = false
function showExpiredSession() {
  main.innerHTML = '<section class="panel"><h1>登录已失效</h1><p>请关闭当前 Tab，从桌面专家库重新打开。</p></section>'
}
function expireSession() {
  sessionExpired = true
  clearInterval(timer)
  tasks = []; selectedFiles = []; options = {}
  showExpiredSession()
}
async function authenticatedFetch(path, options) {
  if (sessionExpired) throw new Error('登录已失效，请重新打开工作台')
  const response = await fetch(path.startsWith('/api/') ? path.slice(1) : path, options)
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
const stateLabels = { queued: '等待处理', running: '正在处理', succeeded: '已完成', failed: '处理失败', cancelled: '已取消' }
const progressHints = {
  'coordinate-transform': '正在转换坐标…',
  'format-convert': '正在转换空间数据格式…',
  'redline-extract': '正在提取红线范围…',
}
let selectedTask
let progressTimer
function emptyMarkup(kind) {
  const records = kind === 'history'
  return `<div class="conversion-empty"><img src="./assets/${records ? 'history' : 'files'}.png" alt=""><strong>${records ? '暂无处理记录' : '暂无成果文件'}</strong><p>${records ? '新建任务后，处理状态和结果会显示在这里。' : '处理完成后，可在这里下载当前用户的实际成果。'}</p><button class="primary" data-page="home">去工作台选工具</button></div>`
}
function toolIcon(id) {
  return './assets/redline-extract.png'
}
function elapsedSeconds(task) {
  const created = Number(task?.created)
  if (!Number.isFinite(created) || created <= 0) return 0
  return Math.max(0, Math.floor(Date.now() / 1000 - created))
}
function formatElapsed(seconds) {
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes} 分 ${rest} 秒`
}
function progressBudget(task) {
  return ({ 'coordinate-transform': 25, 'format-convert': 70, 'redline-extract': 180 })[task.tool] || 40
}
function estimatedProgress(task) {
  // Soft time-based estimate only. Default/queued is 0%; never claims 100% before the server finishes.
  // CSS also defaults the bar to width:0 so a missing inline width cannot flash as a full (100%) track.
  if (!task || task.state === 'queued') return 0
  const elapsed = elapsedSeconds(task)
  if (elapsed <= 0) return 0
  const budget = Math.max(1, progressBudget(task))
  if (elapsed <= budget) {
    const ratio = 1 - Math.exp(-elapsed / (budget * 0.55))
    return Math.min(82, Math.round(ratio * 82))
  }
  // Past the soft budget: keep creeping so a long DWG job does not look frozen at ~82%.
  const over = elapsed - budget
  return Math.min(95, 82 + Math.min(13, Math.floor(Math.log10(over + 10) * 5)))
}
function progressNote(task) {
  const elapsed = elapsedSeconds(task)
  if (task.state === 'queued') return '任务已入队，开始处理后页面会自动更新。'
  if (task.tool === 'redline-extract' && elapsed > progressBudget(task)) {
    return '大 DWG 转换可能较慢。可继续等待，或取消后在 CAD 中另存为 DXF 再上传（通常更快）。进度为估算，不是真实完成比例。'
  }
  if (elapsed > progressBudget(task)) {
    return '已超过常见耗时，任务仍在服务器处理中。进度为估算，完成以状态变为「已完成」为准。'
  }
  return '进度为估算，完成以服务器状态为准。'
}
function progressStage(task) {
  if (task.state === 'queued') return '排队等待中…'
  if (elapsedSeconds(task) > progressBudget(task)) {
    return task.tool === 'redline-extract' ? '仍在处理图纸（可能正在转换 DWG）…' : '仍在处理，请稍候…'
  }
  return progressHints[task.tool] || '正在处理…'
}
function progressMarkup(task, compact = false) {
  if (!['queued', 'running'].includes(task.state)) return ''
  const percent = estimatedProgress(task)
  const elapsed = formatElapsed(elapsedSeconds(task))
  const stage = progressStage(task)
  if (compact) {
    return `<span class="history-progress" aria-hidden="true"><span style="width:${percent}%"></span></span>`
  }
  return `<div class="task-progress" data-progress-task="${escape(task.id)}"><div class="task-progress-meta"><strong data-progress-stage>${escape(stage)}</strong><span data-progress-elapsed>已用时 ${escape(elapsed)}</span><em data-progress-percent>${percent}%</em></div><div class="task-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-label="处理进度"><span class="task-progress-bar" style="width:${percent}%"></span></div><p class="muted" data-progress-note>${escape(progressNote(task))}</p></div>`
}
function historyMarkup() {
  return tasks.length ? `<div class="history-list">${tasks.map(task => {
    const active = ['queued', 'running'].includes(task.state)
    return `<button class="history-row ${active ? 'is-active' : ''}" data-task="${escape(task.id)}"><img src="${toolIcon(task.tool)}" alt=""><span><strong>${escape(task.options.taskName || task.options.title || tools.find(tool => tool.id === task.tool)?.name || task.tool)}</strong><small>${escape(new Date(task.created * 1000).toLocaleString())} · ${task.inputs.length} 个文件 · ${escape(tools.find(tool => tool.id === task.tool)?.name || task.tool)}</small>${active ? progressMarkup(task, true) : ''}</span><em class="${escape(task.state)}">${escape(stateLabels[task.state] || task.state)}</em></button>`
  }).join('')}</div>` : emptyMarkup('history')
}
function filesMarkup() {
  const files = tasks.filter(task => task.state === 'succeeded').flatMap(task => task.outputs.map((name, index) => ({ task, name, index })))
  return files.length ? `<div class="outputs">${files.map(({ task, name, index }) => `<div><span><strong>${escape(name)}</strong><small>${escape(task.options.taskName || task.options.title || tools.find(tool => tool.id === task.tool)?.name || task.tool)}</small></span><a class="primary" href="api/tasks/${escape(task.id)}/files/${index}" download>下载文件</a></div>`).join('')}</div>` : emptyMarkup('files')
}
function taskMarkup() {
  const task = tasks.find(item => item.id === selectedTask)
  if (!task) return '<h1>任务暂不可用</h1><p class="muted">记录可能已超过保留期限，请返回任务记录查看。</p>'
  const tool = tools.find(item => item.id === task.tool)
  const active = ['queued', 'running'].includes(task.state)
  const success = task.state === 'succeeded'
  const taskHeader = `<div class="stepbar"><span>1 准备材料</span><span>2 核对信息</span><span class="current">3 处理与交付</span></div><header class="conversion-task-heading"><span>${escape(tool?.name || task.tool)}</span><h2>${escape(task.options.taskName || task.options.title || tool?.name || task.tool)}</h2><p class="muted">${escape(new Date(task.created * 1000).toLocaleString())} · ${task.inputs.length} 个输入文件</p></header>`
  const outputFiles = `<h3>真实成果文件</h3><div class="conversion-result-files">${success && task.outputs.length ? task.outputs.map((name, index) => {
    const previewable = /\.(csv|txt|tsv|geojson|json|dxf)$/i.test(name)
    return `<div><span>${escape(name)}${previewable ? '<small class="muted">支持页内预览</small>' : '<small class="muted">压缩包/二进制请下载后查看</small>'}</span><span class="result-file-actions"><a class="primary" href="api/tasks/${escape(task.id)}/files/${index}" download>下载文件</a></span></div>`
  }).join('') : '<p class="muted">尚未找到符合本任务要求的成果文件。</p>'}</div>${success && task.outputs.length ? '<div id="result-preview" class="result-preview"><p class="muted">正在加载可预览成果…</p></div>' : ''}`
  const details = `<dl class="conversion-details"><dt>任务名称</dt><dd>${escape(task.options.taskName || task.options.title || tool?.name || task.tool)}</dd><dt>所选工具</dt><dd>${escape(tool?.name || task.tool)}</dd><dt>创建时间</dt><dd>${escape(new Date(task.created * 1000).toLocaleString())}</dd><dt>输入文件</dt><dd>${(task.input_names?.length ? task.input_names : task.inputs).map(name => escape(name)).join('<br>')}</dd>${(tool?.params || []).map(([key, label, values]) => `<dt>${escape(label)}</dt><dd>${escape(parameterText(tool, key, values, task.options[key]))}</dd>`).join('')}</dl>`
  return `<div class="conversion-flow"><button class="text-action" data-page="history">← 返回处理记录</button>${taskHeader}<section class="conversion-result ${escape(task.state)}"><header class="conversion-result-head"><div><small>真实任务状态</small><h3>${escape(stateLabels[task.state] || task.state)}</h3></div></header>${active ? progressMarkup(task) : ''}${task.error ? `<p class="error conversion-result-error">${escape(task.error)}</p>` : ''}${outputFiles}</section><details class="conversion-task-details"><summary>任务详情</summary>${details}</details><div class="actions">${active ? `<button class="secondary" data-cancel="${escape(task.id)}">取消任务</button>` : !success && tool ? `<button class="primary" data-tool="${escape(tool.id)}">重新创建处理</button>` : ''}<button class="secondary" data-page="history">查看处理记录</button></div></div>`
}
function stopProgressTicker() {
  clearInterval(progressTimer)
  progressTimer = undefined
}
function startProgressTicker() {
  stopProgressTicker()
  progressTimer = setInterval(() => {
    const task = tasks.find(item => item.id === selectedTask)
    if (!task || !['queued', 'running'].includes(task.state) || currentPage !== 'result') {
      stopProgressTicker()
      return
    }
    const host = document.querySelector(`[data-progress-task="${task.id}"]`)
    if (!host) return
    const percent = estimatedProgress(task)
    const elapsed = formatElapsed(elapsedSeconds(task))
    const bar = host.querySelector('.task-progress-bar')
    const track = host.querySelector('.task-progress-track')
    const elapsedNode = host.querySelector('[data-progress-elapsed]')
    const percentNode = host.querySelector('[data-progress-percent]')
    const stageNode = host.querySelector('[data-progress-stage]')
    const noteNode = host.querySelector('[data-progress-note]')
    if (bar) bar.style.width = `${percent}%`
    if (track) track.setAttribute('aria-valuenow', String(percent))
    if (elapsedNode) elapsedNode.textContent = `已用时 ${elapsed}`
    if (percentNode) percentNode.textContent = `${percent}%`
    if (stageNode) stageNode.textContent = progressStage(task)
    if (noteNode) noteNode.textContent = progressNote(task)
  }, 1000)
}
function parseCsvPreview(text, limit = 50) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.length)
  if (!lines.length) return { headers: [], rows: [], total: 0 }
  const split = line => {
    const cells = []
    let current = '', inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; continue }
        inQuotes = !inQuotes
        continue
      }
      if (char === ',' && !inQuotes) { cells.push(current); current = ''; continue }
      current += char
    }
    cells.push(current)
    return cells
  }
  const headers = split(lines[0])
  const rows = lines.slice(1, limit + 1).map(split)
  return { headers, rows, total: Math.max(0, lines.length - 1) }
}
function csvPreviewMarkup(name, text) {
  const { headers, rows, total } = parseCsvPreview(text)
  if (!headers.length) return `<section class="preview-card"><h4>${escape(name)}</h4><p class="muted">文件为空</p></section>`
  const head = `<tr>${headers.map(cell => `<th>${escape(cell)}</th>`).join('')}</tr>`
  const body = rows.map(row => `<tr>${headers.map((_, index) => `<td>${escape(row[index] ?? '')}</td>`).join('')}</tr>`).join('')
  return `<section class="preview-card"><h4>${escape(name)}</h4><p class="muted">共 ${total} 行，预览前 ${rows.length} 行</p><div class="preview-table-wrap"><table class="preview-table"><thead>${head}</thead><tbody>${body}</tbody></table></div></section>`
}
function geojsonPreviewMarkup(name, text) {
  let data
  try { data = JSON.parse(text) } catch { return `<section class="preview-card"><h4>${escape(name)}</h4><p class="error">GeoJSON 解析失败</p></section>` }
  const features = Array.isArray(data.features) ? data.features : (data.type === 'Feature' ? [data] : [])
  const sample = features.slice(0, 20).map((feature, index) => {
    const layer = feature.properties?.layer ?? feature.properties?.NAME ?? ''
    const geometry = feature.geometry?.type || '未知'
    const coords = feature.geometry?.coordinates
    let point = ''
    if (geometry === 'Polygon' && Array.isArray(coords?.[0]?.[0])) point = `${coords[0][0][0]}, ${coords[0][0][1]}`
    else if (geometry === 'Point' && Array.isArray(coords)) point = `${coords[0]}, ${coords[1]}`
    return `<tr><td>${index + 1}</td><td>${escape(geometry)}</td><td>${escape(layer)}</td><td>${escape(point)}</td></tr>`
  }).join('')
  return `<section class="preview-card"><h4>${escape(name)}</h4><p class="muted">共 ${features.length} 个要素，预览前 ${Math.min(features.length, 20)} 个</p><div class="preview-table-wrap"><table class="preview-table"><thead><tr><th>#</th><th>几何</th><th>图层/名称</th><th>首点坐标</th></tr></thead><tbody>${sample || '<tr><td colspan="4">无要素</td></tr>'}</tbody></table></div></section>`
}
function textPreviewMarkup(name, text) {
  const clipped = text.length > 20000 ? `${text.slice(0, 20000)}\n…（已截断）` : text
  return `<section class="preview-card"><h4>${escape(name)}</h4><pre class="preview-code">${escape(clipped)}</pre></section>`
}
async function loadResultPreviews(task) {
  const host = document.querySelector('#result-preview')
  if (!host || task?.state !== 'succeeded') return
  const parts = []
  for (let index = 0; index < task.outputs.length; index++) {
    const name = task.outputs[index]
    const lower = name.toLowerCase()
    if (!/\.(csv|txt|tsv|geojson|json|dxf)$/.test(lower)) continue
    try {
      const response = await authenticatedFetch(`api/tasks/${task.id}/files/${index}`)
      if (!response.ok) throw new Error('读取失败')
      const length = Number(response.headers.get('content-length') || 0)
      if (length > 2 * 1024 * 1024) {
        parts.push(`<section class="preview-card"><h4>${escape(name)}</h4><p class="muted">文件超过 2 MB，请下载后查看完整内容。</p></section>`)
        continue
      }
      const text = await response.text()
      if (/\.(csv|tsv)$/.test(lower) || (/\.txt$/.test(lower) && text.includes(','))) parts.push(csvPreviewMarkup(name, text))
      else if (/\.(geojson|json)$/.test(lower)) parts.push(geojsonPreviewMarkup(name, text))
      else parts.push(textPreviewMarkup(name, text))
    } catch (error) {
      parts.push(`<section class="preview-card"><h4>${escape(name)}</h4><p class="error">${escape(error.message || '预览失败')}</p></section>`)
    }
  }
  host.innerHTML = parts.length ? `<h3>成果预览</h3>${parts.join('')}` : '<p class="muted">当前成果为压缩包或二进制，请下载后用 GIS 软件打开。</p>'
}
function formatChipMarkup(chips, output) {
  return `<div class="conversion-format-chips"><small>支持格式</small>${chips.map(chip => `<b>${escape(chip)}</b>`).join('')}${output ? `<em>→</em><b>${escape(output)}</b>` : ''}</div>`
}
function homeMarkup() {
  const tool = tools[0]
  const facts = [['原文件不覆盖', '成果另行保存'], ['参数可核对', '提交前确认转换设置'], ['成果可导出', '支持本机另存为']]
  const formatChips = {
    'coordinate-transform': { chips: ['.csv', '.txt', '.tsv'], output: '.csv' },
    'format-convert': { chips: ['.zip/.shp', '.gdb', '.mdb', '.dwg', '.dxf'], output: '' },
    'redline-extract': { chips: ['.dwg', '.dxf'], output: 'GeoJSON / SHP' },
  }
  const formats = formatChips[tool.id] || { chips: [], output: '' }
  const recent = tasks.slice(0, 3)
  const recentRows = recent.length
    ? `<div class="history-list">${recent.map(task => `<button class="history-row" data-task="${escape(task.id)}"><img src="${toolIcon(task.tool)}" alt=""><span><strong>${escape(task.options.taskName || task.options.title || tools.find(item => item.id === task.tool)?.name || task.tool)}</strong><small>${escape(new Date(task.created * 1000).toLocaleString())} · ${task.inputs.length} 个文件</small></span><em class="${escape(task.state)}">${escape(stateLabels[task.state] || task.state)}</em></button>`).join('')}</div>`
    : '<div class="conversion-empty"><svg class="ui-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/></svg><strong>还没有处理记录</strong><p>点击上方「开始处理」新建本专家任务。</p></div>'
  return `<div class="conversion-dashboard"><section class="conversion-hero"><h1>从图纸中提取闭合红线范围</h1><p>从 DWG / DXF 提取闭合多段线，导出 GeoJSON 和/或 Shapefile ZIP。可指定图层，或自动匹配含“红线/REDLINE”等关键字的图层。</p><div>${facts.map(([name,detail]) => `<span><strong>${name}</strong><small>${detail}</small></span>`).join('')}</div></section><section class="conversion-feature"><img src="${toolIcon(tool.id)}" alt="DWG 红线提取"><div class="conversion-feature-body"><h2>${escape(tool.name)}</h2><p>${escape(tool.description)}</p>${formatChipMarkup(formats.chips, formats.output)}<button class="primary" data-tool="${tool.id}">开始处理</button></div></section><section class="conversion-recent"><div><h2>最近处理</h2><button class="text-action" data-page="history">查看全部</button></div>${recentRows}</section></div>`
}
function guideMarkup() {
  const sections = [
    ['01 / 红线提取', '红线提取', '从 DWG/DXF 提取闭合多段线。可指定图层；留空则匹配名称含“红线”等关键字的图层。成果可导出 GeoJSON 或 Shapefile。图纸若无坐标系元数据，请在下游自行定义参考系。', 'redline-extract'],
    ['02 / 任务与成果', '任务与成果', '关闭网页后任务仍由专家服务处理。桌面端下载走原生另存为。取消会终止处理进程且不发布成果。', null],
  ]
  return `<div class="guide-page"><button class="text-action" data-page="home">← 返回首页</button><section class="guide-hero"><span class="eyebrow">使用指南</span><h1>红线提取</h1><p>从 DWG/DXF 提取闭合多段线，导出 GeoJSON 和/或 Shapefile ZIP。可指定图层，或自动匹配含“红线/REDLINE”等关键字的图层。</p><button class="primary" data-page="home">＋ 新建任务</button></section><div class="guide-grid">${sections.map(([badge, title, body, toolId]) => `<section class="panel"><span>${escape(badge)}</span><h2>${escape(title)}</h2><p>${escape(body)}</p>${toolId ? `<button class="text-action" data-tool="${escape(toolId)}">开始${escape(title)} →</button>` : '<button class="text-action" data-page="home">去工作台选工具 →</button>'}</section>`).join('')}</div></div>`
}
function updateNavigation() {
  const page = currentPage === 'form' ? 'home' : currentPage === 'result' ? 'history' : currentPage
  document.querySelectorAll('aside [data-page]').forEach(node => node.classList.toggle('active', node.dataset.page === page))
}
function render() {
  if (sessionExpired) { showExpiredSession(); return }
  updateNavigation()
  if (currentPage === 'home') main.innerHTML = homeMarkup()
  if (currentPage === 'history' || currentPage === 'files') main.innerHTML = `<h1>${currentPage === 'history' ? '我的处理记录' : '我的成果文件'}</h1><p class="muted">仅展示当前用户在本专家服务中的任务。</p>${currentPage === 'history' ? historyMarkup() : filesMarkup()}`
  if (currentPage === 'result') main.innerHTML = taskMarkup()
  if (currentPage === 'guide') main.innerHTML = guideMarkup()
  bind()
  if (currentPage === 'result') {
    const task = tasks.find(item => item.id === selectedTask)
    if (task?.state === 'succeeded') loadResultPreviews(task)
    if (task && ['queued', 'running'].includes(task.state)) startProgressTicker()
    else stopProgressTicker()
  } else {
    stopProgressTicker()
  }
}
function bind() {
  main.querySelectorAll('a[download]').forEach(link => {
    if (typeof window.__ZJUGIS_NATIVE_INVOKE__ !== 'function') return
    link.onclick = async event => {
      event.preventDefault()
      if (link.dataset.saving === 'true') return
      link.dataset.saving = 'true'
      try { const path = await saveArtifact(link); if (path) toast(`成果已保存：${path}`) }
      catch (error) { toast(error.message || '成果保存失败，请重试') }
      finally { link.dataset.saving = 'false' }
    }
  })
  main.querySelectorAll('[data-task]').forEach(node => node.onclick = () => { selectedTask = node.dataset.task; currentPage = 'result'; render() })
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
  return await window.__ZJUGIS_NATIVE_INVOKE__('save_expert_artifact', { fileName, bytesBase64 })
}
function prepareFileHint(tool) {
  if (tool.id === 'coordinate-transform') {
    return '单个任务总大小不超过 64 MB。首行必须是字段名；默认字段为 x / y（可改右侧名称）。七参数请使用含高程列的模板，并把「Z / 高程字段名」填成 z。'
  }
  if (tool.id === 'format-convert') {
    return '单个任务总大小不超过 64 MB。FileGDB：压缩整个 xxx.gdb 文件夹，或压缩其内部文件（须含 .gdbtable）。Shapefile：ZIP 内须有 .shp/.shx/.dbf。'
  }
  return '单个任务总大小不超过 64 MB。支持 .dwg / .dxf；大图建议先另存为 DXF。'
}
const coordinateTemplates = {
  csv: {
    fileName: 'coordinate-points.csv',
    body: 'id,x,y\n1,120.15,30.28\n2,120.16,30.29\n3,120.17,30.30\n',
  },
  txt: {
    fileName: 'coordinate-points.txt',
    body: 'id,x,y\n1,120.15,30.28\n2,120.16,30.29\n3,120.17,30.30\n',
  },
  'csv-z': {
    fileName: 'coordinate-points-with-z.csv',
    body: 'id,x,y,z\n1,120.15,30.28,12.5\n2,120.16,30.29,13.0\n3,120.17,30.30,11.8\n',
  },
}
function coordinateTemplateMarkup(tool) {
  if (tool.id !== 'coordinate-transform') return ''
  return `<div class="template-downloads"><strong>数据模板</strong><p class="muted">下载后按同样表头整理坐标，再上传。示例为杭州附近经纬度（EPSG:4326）。</p><div class="template-download-actions"><button type="button" class="secondary" data-template="csv">下载 CSV 模板</button><button type="button" class="secondary" data-template="txt">下载 TXT 模板</button><button type="button" class="text-action" data-template="csv-z">七参数用（含 z）</button></div></div>`
}
function bytesToBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}
async function downloadCoordinateTemplate(key) {
  const template = coordinateTemplates[key]
  if (!template) return
  const bytes = new TextEncoder().encode(template.body)
  if (typeof window.__ZJUGIS_NATIVE_INVOKE__ === 'function') {
    const path = await window.__ZJUGIS_NATIVE_INVOKE__('save_expert_artifact', {
      fileName: template.fileName,
      bytesBase64: bytesToBase64(bytes),
    })
    if (path) toast(`模板已保存：${path}`)
    return
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = template.fileName
  link.click()
  URL.revokeObjectURL(url)
  toast(`已开始下载 ${template.fileName}`)
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
  main.innerHTML = `<h1>${escape(tool.name)}</h1><p class="muted">${escape(tool.description)}</p><div class="stepbar"><span class="current">1 准备文件</span><span>2 确认任务</span><span>3 处理与结果</span></div><div class="formgrid"><section class="panel"><label>任务名称<input id="task-name" maxlength="180" value="${escape(options.taskName || '')}" placeholder="留空则按工具名称展示"></label>${coordinateTemplateMarkup(tool)}<input id="upload" type="file" hidden accept="${tool.accept}" ${tool.multiple ? 'multiple' : ''}><button type="button" id="dropzone" class="dropzone conversion-upload"><img src="${toolIcon(tool.id)}" alt=""><strong>点击选择或拖入文件</strong><small>${escape(tool.accept)} · 每次选择一份文件</small></button><p class="muted">${escape(prepareFileHint(tool))}</p><div id="filelist" class="filelist"></div></section><section class="panel"><h2>处理参数</h2>${tool.params.map(([key, label, values, value]) => `<label>${escape(label)}${values ? `<select data-param="${key}">${values.map(entry => { const [id, text] = Array.isArray(entry) ? entry : [entry, entry]; return `<option value="${escape(id)}" ${id === value ? 'selected' : ''}>${escape(text)}</option>` }).join('')}</select>` : `<input data-param="${key}" value="${escape(value)}">`}</label>`).join('')}</section></div><div class="actions"><button class="secondary" id="back">返回</button><button class="primary" id="review">下一步：确认任务</button></div>`
  document.querySelectorAll('[data-param]').forEach(node => { node.value = options[node.dataset.param] ?? '' })
  updateFileList()
  document.querySelector('#upload').onchange = event => { selectFiles(event.target.files) }
  document.querySelector('#task-name').oninput = event => { options.taskName = event.target.value }
  const dropzone = document.querySelector('#dropzone')
  dropzone.onclick = () => document.querySelector('#upload').click()
  dropzone.ondragover = event => { event.preventDefault(); dropzone.classList.add('dragging') }
  dropzone.ondragleave = event => { if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('dragging') }
  dropzone.ondrop = event => { event.preventDefault(); dropzone.classList.remove('dragging'); selectFiles(event.dataTransfer.files) }
  document.querySelectorAll('[data-param]').forEach(node => node.onchange = () => { options[node.dataset.param] = node.value })
  document.querySelectorAll('[data-template]').forEach(node => node.onclick = async () => {
    try { await downloadCoordinateTemplate(node.dataset.template) }
    catch (error) { toast(error.message || '模板下载失败，请重试') }
  })
  document.querySelector('#back').onclick = () => { currentPage = 'home'; render() }
  document.querySelector('#review').onclick = review
}
function selectFiles(incoming) {
  const added = Array.from(incoming)
  if (!added.length) return false
  if (added.length !== 1) { toast('这个工具一次只能选择一个文件'); return false }
  if (added.reduce((sum, file) => sum + file.size, 0) > 64 * 1024 * 1024) { toast('文件总大小不超过 64 MB'); return false }
  const extensions = selectedTool.accept.split(',')
  if (added.some(file => !file.size || !extensions.some(extension => file.name.toLowerCase().endsWith(extension)))) {
    toast('文件为空或格式不支持，请按工具要求选择文件')
    return false
  }
  selectedFiles = added
  updateFileList()
  return true
}
function updateFileList() {
  const list = document.querySelector('#filelist')
  list.innerHTML = selectedFiles.map((file, index) => `<div class="file-entry"><span>${index + 1}. ${escape(file.name)} <small class="muted">${(file.size / 1024).toFixed(1)} KB</small></span><div><button type="button" data-remove="${index}" aria-label="移除 ${escape(file.name)}">移除</button></div></div>`).join('')
  list.querySelectorAll('[data-remove]').forEach(node => node.onclick = () => {
    selectedFiles.splice(Number(node.dataset.remove), 1)
    updateFileList()
  })
}
function review() {
  if (selectedTool.id === 'coordinate-transform') {
    if (!options.xField?.trim() || !options.yField?.trim()) return toast('请填写坐标字段名')
    if (options.method === 'epsg' && (!/^\d{4,6}$/.test(options.sourceEpsg || '') || !/^\d{4,6}$/.test(options.targetEpsg || ''))) return toast('请填写有效的源/目标 EPSG')
    if (options.method === 'four-param' && ['dx', 'dy', 'rotation', 'scale'].some(key => !String(options[key] ?? '').trim())) return toast('四参数须填写 ΔX、ΔY、旋转角和尺度')
    if (options.method === 'seven-param') {
      if (!options.zField?.trim()) return toast('七参数须填写高程字段名')
      if (['dx', 'dy', 'dz', 'rx', 'ry', 'rz', 'scale'].some(key => !String(options[key] ?? '').trim())) return toast('请完整填写七参数')
    }
  }
  if (!selectedFiles.length || selectedFiles.reduce((sum, file) => sum + file.size, 0) > 64 * 1024 * 1024) return toast('请选择 1 个文件，总大小不超过 64 MB')
  main.innerHTML = `<h1>核对处理信息</h1><div class="stepbar"><span>1 准备文件</span><span class="current">2 核对信息</span><span>3 处理与结果</span></div><section class="panel review conversion-review"><h2>${escape(options.taskName?.trim() || selectedTool.name)}</h2><dl class="conversion-details"><dt>处理类型</dt><dd>${escape(selectedTool.name)}</dd><dt>输入文件</dt><dd>${selectedFiles.map(file => escape(file.name)).join('<br>')}</dd>${selectedTool.params.map(([key, label, values]) => `<dt>${escape(label)}</dt><dd>${escape(parameterText(selectedTool, key, values, options[key]))}</dd>`).join('')}<dt>预计成果</dt><dd>${escape(expectedOutputs(selectedTool, options))}<small class="muted">实际成果以任务完成后生成的文件为准。</small></dd></dl></section><div class="actions"><button class="secondary" id="return">返回修改</button><button class="primary" id="start">开始处理</button></div>`
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
    const created = await api('/api/tasks', { tool: selectedTool.id, options, files })
    selectedTask = created.id
    currentPage = 'result'
    await refresh()
    toast('任务已提交，正在处理')
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
  const previousSelected = tasks.find(item => item.id === selectedTask)
  const changed = !tasksLoaded || JSON.stringify(items) !== JSON.stringify(tasks)
  tasks = items
  tasksLoaded = true
  if (!changed || currentPage === 'form') return
  // Keep the live progress bar mounted when only unrelated tasks changed; remounting
  // would restart the soft estimate and look like progress jumped.
  if (currentPage === 'result') {
    const nextSelected = tasks.find(item => item.id === selectedTask)
    if (previousSelected && nextSelected && JSON.stringify(previousSelected) === JSON.stringify(nextSelected)
      && ['queued', 'running'].includes(nextSelected.state)) {
      return
    }
  }
  render()
}
document.querySelectorAll('[data-page]').forEach(node => node.onclick = () => { currentPage = node.dataset.page; render() })
async function boot() {
  try {
    const ticket = new URLSearchParams(location.hash.slice(1)).get('ticket')
    history.replaceState(null, '', location.pathname)
    if (ticket) await api('/api/session', { ticket })
    currentPage = 'home'
    await refresh()
    if (currentPage === 'home') render()
    timer = setInterval(() => { refresh().catch(error => { clearInterval(timer); toast(error.message) }) }, 2500)
  } catch (error) { main.innerHTML = `<section class="panel"><h1>无法打开工作台</h1><p class="error">${escape(error.message)}</p><p class="muted">请关闭当前 Tab，从桌面专家库重新打开。</p></section>` }
}
window.addEventListener('pagehide', () => { clearInterval(timer); stopProgressTicker() })
boot()
