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
const overlayState = {
  taskId: undefined,
  result: null,
  localLayers: [],
  onlineLayers: [],
  layerVisibility: {},
  mapConfig: null,
  serviceModalOpen: false,
  serviceModalEditId: null,
  geometryModal: null,
  view: { zoom: 1, offsetX: 0, offsetY: 0 },
  pan: null,
  rasterCache: null,
  drawToken: 0,
  map: null,
  onlineNote: '',
  autoFittedOnline: {},
  layerPanelOpen: false,
}
const MAP_ZOOM_MIN = 0.2
const MAP_ZOOM_MAX = 28
const ONLINE_LAYERS_KEY = 'cad-redline-online-layers'
let previewGeometryCollections = []
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
  if (response.status === 401 && path !== '/api/session') {
    expireSession()
    throw new Error('登录已失效，请重新打开工作台')
  }
  return response
}
async function api(path, body) {
  if (sessionExpired) throw new Error('登录已失效，请重新打开工作台')
  const response = await authenticatedFetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  if (response.status === 401) {
    // Boot ticket redeem should not lock the whole page into expireSession UI.
    if (path === '/api/session') throw new Error(data.error || '登录票据已失效，请重新打开工作台')
    expireSession()
    throw new Error('登录已失效，请重新打开工作台')
  }
  if (sessionExpired) throw new Error('登录已失效，请重新打开工作台')
  if (!response.ok) {
    const error = new Error(data.error || '请求失败')
    error.payload = data
    throw error
  }
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
    return `<div class="history-row ${active ? 'is-active' : ''}"><button type="button" class="history-open" data-task="${escape(task.id)}"><img src="${toolIcon(task.tool)}" alt=""><span><strong>${escape(task.options.taskName || task.options.title || tools.find(tool => tool.id === task.tool)?.name || task.tool)}</strong><small>${escape(new Date(task.created * 1000).toLocaleString())} · ${task.inputs.length} 个文件 · ${escape(tools.find(tool => tool.id === task.tool)?.name || task.tool)}</small>${active ? progressMarkup(task, true) : ''}</span><em class="${escape(task.state)}">${escape(stateLabels[task.state] || task.state)}</em></button>${active ? '' : `<button type="button" class="secondary delete-task" data-delete="${escape(task.id)}">删除</button>`}</div>`
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
  }).join('') : '<p class="muted">尚未找到符合本任务要求的成果文件。</p>'}</div>${success && task.outputs.length ? '<div id="result-preview" class="result-preview"><p class="muted">正在加载可预览成果…</p></div><div id="result-overlay" class="result-overlay"><p class="muted">正在准备成果套合…</p></div>' : ''}`
  const details = `<dl class="conversion-details"><dt>任务名称</dt><dd>${escape(task.options.taskName || task.options.title || tool?.name || task.tool)}</dd><dt>所选工具</dt><dd>${escape(tool?.name || task.tool)}</dd><dt>创建时间</dt><dd>${escape(new Date(task.created * 1000).toLocaleString())}</dd><dt>输入文件</dt><dd>${(task.input_names?.length ? task.input_names : task.inputs).map(name => escape(name)).join('<br>')}</dd>${(tool?.params || []).map(([key, label, values]) => `<dt>${escape(label)}</dt><dd>${escape(parameterText(tool, key, values, task.options[key]))}</dd>`).join('')}</dl>`
  return `<div class="conversion-flow"><button class="text-action" data-page="history">← 返回处理记录</button>${taskHeader}<section class="conversion-result ${escape(task.state)}"><header class="conversion-result-head"><div><small>真实任务状态</small><h3>${escape(stateLabels[task.state] || task.state)}</h3></div></header>${active ? progressMarkup(task) : ''}${task.error ? `<p class="error conversion-result-error">${escape(task.error)}</p>` : ''}${outputFiles}</section><details class="conversion-task-details"><summary>任务详情</summary>${details}</details><div class="actions">${active ? `<button class="secondary" data-cancel="${escape(task.id)}">取消任务</button>` : `${!success && tool ? `<button class="primary" data-tool="${escape(tool.id)}">重新创建处理</button>` : ''}<button class="secondary delete-task" data-delete="${escape(task.id)}">删除记录</button>`}<button class="secondary" data-page="history">查看处理记录</button></div></div>`
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
  const previewId = previewGeometryCollections.length
  previewGeometryCollections.push({ name, features })
  const sample = features.slice(0, 20).map((feature, index) => {
    const layer = feature.properties?.layer ?? feature.properties?.NAME ?? feature.properties?.name ?? ''
    const geometry = feature.geometry?.type || '未知'
    const coords = feature.geometry?.coordinates
    let point = ''
    if (geometry === 'Polygon' && Array.isArray(coords?.[0]?.[0])) point = `${coords[0][0][0]}, ${coords[0][0][1]}`
    else if (geometry === 'Point' && Array.isArray(coords)) point = `${coords[0]}, ${coords[1]}`
    return `<tr><td>${index + 1}</td><td>${escape(geometry)}</td><td>${escape(layer)}</td><td>${escape(point)}</td><td><button type="button" class="text-action" data-preview-geometry="${previewId}" data-preview-feature="${index}">查看</button></td></tr>`
  }).join('')
  return `<section class="preview-card"><div class="preview-card-head"><div><h4>${escape(name)}</h4><p class="muted">共 ${features.length} 个要素，预览前 ${Math.min(features.length, 20)} 个</p></div><button type="button" class="secondary" data-preview-geometry="${previewId}">查看</button></div><div class="preview-table-wrap"><table class="preview-table"><thead><tr><th>#</th><th>几何</th><th>图层/名称</th><th>首点坐标</th><th></th></tr></thead><tbody>${sample || '<tr><td colspan="5">无要素</td></tr>'}</tbody></table></div></section>`
}
function textPreviewMarkup(name, text) {
  const clipped = text.length > 20000 ? `${text.slice(0, 20000)}\n…（已截断）` : text
  return `<section class="preview-card"><h4>${escape(name)}</h4><pre class="preview-code">${escape(clipped)}</pre></section>`
}
function parseFeatureCollection(text) {
  const data = JSON.parse(text)
  if (data?.type === 'FeatureCollection' && Array.isArray(data.features)) return { type: 'FeatureCollection', features: data.features }
  if (data?.type === 'Feature') return { type: 'FeatureCollection', features: [data] }
  throw new Error('GeoJSON 结构无效')
}
function featureLabel(feature, index) {
  const props = feature?.properties || {}
  return props.layer || props.NAME || props.name || props.id || `要素 ${index + 1}`
}
function walkCoordinates(node, visit) {
  if (!Array.isArray(node)) return
  if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
    visit(node[0], node[1])
    return
  }
  node.forEach(child => walkCoordinates(child, visit))
}
function collectionBounds(collections) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0
  for (const collection of collections) {
    for (const feature of collection?.features || []) {
      walkCoordinates(feature.geometry?.coordinates, (x, y) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return
        minX = Math.min(minX, x); minY = Math.min(minY, y)
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
        count += 1
      })
    }
  }
  if (!count) return null
  if (minX === maxX) { minX -= 1; maxX += 1 }
  if (minY === maxY) { minY -= 1; maxY += 1 }
  return { minX, minY, maxX, maxY }
}
function looksGeographic(bounds) {
  if (!bounds) return false
  return bounds.minX >= -180 && bounds.maxX <= 180 && bounds.minY >= -90 && bounds.maxY <= 90
}
function normalizeCrsInput(value) {
  const raw = String(value || '').trim() || 'EPSG:4326'
  if (/^\d+$/.test(raw)) return `EPSG:${raw}`
  const match = raw.match(/^EPSG\s*:\s*(\d+)$/i)
  return match ? `EPSG:${match[1]}` : raw
}
function suggestedOverlayCrs(bounds) {
  if (!bounds) return overlayState.mapConfig?.defaultCrs || 'EPSG:4326'
  if (looksGeographic(bounds)) return 'EPSG:4490'
  // CGCS2000 / 3-degree Gauss-Kruger: easting prefix is the zone (EPSG:4528 = zone 40).
  const midX = (bounds.minX + bounds.maxX) / 2
  if (midX > 3e6 && midX < 6e7) {
    const zone = Math.floor(midX / 1e6)
    if (zone >= 25 && zone <= 45) return `EPSG:${4488 + zone}`
  }
  return 'EPSG:4528'
}
function crsMatchesBounds(crs, bounds) {
  if (!bounds || !crs) return true
  const code = normalizeCrsInput(crs).replace(/^EPSG:/i, '')
  const geographicCodes = new Set(['4326', '4490', '4214', '4610'])
  const isGeoCrs = geographicCodes.has(code)
  const isGeoData = looksGeographic(bounds)
  return isGeoCrs === isGeoData
}
function lonLatToWorld(lon, lat) {
  const x = (lon + 180) / 360
  const sin = Math.sin(lat * Math.PI / 180)
  const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)
  return { x, y }
}
function projectPoint(x, y, bounds, width, height, padding, geographic) {
  if (geographic) {
    const topLeft = lonLatToWorld(bounds.minX, bounds.maxY)
    const bottomRight = lonLatToWorld(bounds.maxX, bounds.minY)
    const world = lonLatToWorld(x, y)
    const spanX = Math.max(bottomRight.x - topLeft.x, 1e-12)
    const spanY = Math.max(bottomRight.y - topLeft.y, 1e-12)
    const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY)
    return {
      x: padding + (world.x - topLeft.x) * scale + ((width - padding * 2) - spanX * scale) / 2,
      y: padding + (world.y - topLeft.y) * scale + ((height - padding * 2) - spanY * scale) / 2,
      scale,
      originX: topLeft.x,
      originY: topLeft.y,
    }
  }
  const spanX = bounds.maxX - bounds.minX
  const spanY = bounds.maxY - bounds.minY
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY)
  return {
    x: padding + (x - bounds.minX) * scale + ((width - padding * 2) - spanX * scale) / 2,
    y: height - (padding + (y - bounds.minY) * scale + ((height - padding * 2) - spanY * scale) / 2),
    scale,
    originX: bounds.minX,
    originY: bounds.minY,
  }
}
function ringToPath(ctx, ring, bounds, width, height, padding, geographic) {
  if (!Array.isArray(ring) || ring.length < 2) return
  ring.forEach((point, index) => {
    const projected = projectPoint(point[0], point[1], bounds, width, height, padding, geographic)
    if (index === 0) ctx.moveTo(projected.x, projected.y)
    else ctx.lineTo(projected.x, projected.y)
  })
}
function drawGeometry(ctx, geometry, bounds, width, height, padding, geographic, style) {
  if (!geometry) return
  const kind = geometry.type
  const coordinates = geometry.coordinates
  ctx.beginPath()
  if (kind === 'Point') {
    const point = projectPoint(coordinates[0], coordinates[1], bounds, width, height, padding, geographic)
    ctx.arc(point.x, point.y, style.pointRadius || 4, 0, Math.PI * 2)
  } else if (kind === 'MultiPoint') {
    coordinates.forEach(pair => {
      const point = projectPoint(pair[0], pair[1], bounds, width, height, padding, geographic)
      ctx.moveTo(point.x + (style.pointRadius || 4), point.y)
      ctx.arc(point.x, point.y, style.pointRadius || 4, 0, Math.PI * 2)
    })
  } else if (kind === 'LineString') {
    ringToPath(ctx, coordinates, bounds, width, height, padding, geographic)
  } else if (kind === 'MultiLineString') {
    coordinates.forEach(line => ringToPath(ctx, line, bounds, width, height, padding, geographic))
  } else if (kind === 'Polygon') {
    coordinates.forEach(ring => ringToPath(ctx, ring, bounds, width, height, padding, geographic))
  } else if (kind === 'MultiPolygon') {
    coordinates.forEach(polygon => polygon.forEach(ring => ringToPath(ctx, ring, bounds, width, height, padding, geographic)))
  }
  const fillable = kind === 'Polygon' || kind === 'MultiPolygon' || kind === 'Point' || kind === 'MultiPoint'
  if (style.fill && fillable) {
    ctx.fillStyle = style.fill
    ctx.fill(style.fillRule || 'evenodd')
  }
  ctx.strokeStyle = style.stroke
  ctx.lineWidth = style.lineWidth || 2
  ctx.stroke()
}
function mapContentRect(bounds, width, height, padding, geographic) {
  const corners = [
    projectPoint(bounds.minX, bounds.minY, bounds, width, height, padding, geographic),
    projectPoint(bounds.minX, bounds.maxY, bounds, width, height, padding, geographic),
    projectPoint(bounds.maxX, bounds.minY, bounds, width, height, padding, geographic),
    projectPoint(bounds.maxX, bounds.maxY, bounds, width, height, padding, geographic),
  ]
  const left = Math.min(...corners.map(point => point.x))
  const right = Math.max(...corners.map(point => point.x))
  const top = Math.min(...corners.map(point => point.y))
  const bottom = Math.max(...corners.map(point => point.y))
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}
function loadImageFromBase64(contentType, imageBase64) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('在线服务图像无法显示'))
    image.src = `data:${contentType};base64,${imageBase64}`
  })
}
function boundsFromExtent(extent) {
  if (!Array.isArray(extent) || extent.length !== 4) return null
  const values = extent.map(Number)
  if (values.some(value => !Number.isFinite(value))) return null
  if (!(values[0] < values[2] && values[1] < values[3])) return null
  return { minX: values[0], minY: values[1], maxX: values[2], maxY: values[3] }
}
function unionBoundsList(parts) {
  const valid = parts.filter(Boolean)
  if (!valid.length) return null
  return {
    minX: Math.min(...valid.map(item => item.minX)),
    minY: Math.min(...valid.map(item => item.minY)),
    maxX: Math.max(...valid.map(item => item.maxX)),
    maxY: Math.max(...valid.map(item => item.maxY)),
  }
}
function boundsIntersect(a, b) {
  if (!a || !b) return false
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY)
}
function intersectBounds(a, b) {
  if (!a || !b || !boundsIntersect(a, b)) return null
  return {
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY),
  }
}
function expandBounds(bounds, ratio = 0.05) {
  if (!bounds) return null
  const padX = Math.max((bounds.maxX - bounds.minX) * ratio, 1e-6)
  const padY = Math.max((bounds.maxY - bounds.minY) * ratio, 1e-6)
  return {
    minX: bounds.minX - padX,
    minY: bounds.minY - padY,
    maxX: bounds.maxX + padX,
    maxY: bounds.maxY + padY,
  }
}
function canvasToContentPoint(screenX, screenY, width, height) {
  const view = overlayState.view
  const cx = width / 2
  const cy = height / 2
  return {
    x: cx + (screenX - cx - view.offsetX) / view.zoom,
    y: cy + (screenY - cy - view.offsetY) / view.zoom,
  }
}
function contentToMapPoint(contentX, contentY, bounds, width, height, padding, geographic) {
  if (geographic) {
    const topLeft = lonLatToWorld(bounds.minX, bounds.maxY)
    const bottomRight = lonLatToWorld(bounds.maxX, bounds.minY)
    const spanX = Math.max(bottomRight.x - topLeft.x, 1e-12)
    const spanY = Math.max(bottomRight.y - topLeft.y, 1e-12)
    const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY)
    const offsetX = padding + ((width - padding * 2) - spanX * scale) / 2
    const offsetY = padding + ((height - padding * 2) - spanY * scale) / 2
    const worldX = topLeft.x + (contentX - offsetX) / scale
    const worldY = topLeft.y + (contentY - offsetY) / scale
    const lon = worldX * 360 - 180
    const n = Math.PI - 2 * Math.PI * worldY
    const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
    return { x: lon, y: lat }
  }
  const spanX = bounds.maxX - bounds.minX
  const spanY = bounds.maxY - bounds.minY
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY)
  const offsetX = padding + ((width - padding * 2) - spanX * scale) / 2
  const offsetY = padding + ((height - padding * 2) - spanY * scale) / 2
  return {
    x: bounds.minX + (contentX - offsetX) / scale,
    y: bounds.minY + (height - contentY - offsetY) / scale,
  }
}
function visibleMapBounds(worldBounds, width, height, padding, geographic) {
  if (!worldBounds) return null
  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ].map(([sx, sy]) => {
    const content = canvasToContentPoint(sx, sy, width, height)
    return contentToMapPoint(content.x, content.y, worldBounds, width, height, padding, geographic)
  })
  return {
    minX: Math.min(...corners.map(point => point.x)),
    minY: Math.min(...corners.map(point => point.y)),
    maxX: Math.max(...corners.map(point => point.x)),
    maxY: Math.max(...corners.map(point => point.y)),
  }
}
function onlineLayerBounds(layer) {
  return boundsFromExtent(layer?.extent)
}
function worldMapBounds() {
  const featureBounds = collectionBounds([{ features: allMapFeatures() }])
  const online = overlayState.onlineLayers
    .filter(layer => layerVisible(`online:${layer.id}`))
    .map(onlineLayerBounds)
  return unionBoundsList([featureBounds, ...online])
}
function applyOnlineServiceMeta(service, payload) {
  if (!service || !payload) return false
  let changed = false
  if (payload.crs && payload.crs !== service.crs) {
    service.crs = payload.crs
    changed = true
  }
  if (payload.serviceCrs && !service.crs) {
    service.crs = payload.serviceCrs
    changed = true
  }
  if (payload.token && payload.token !== service.token) {
    service.token = payload.token
    changed = true
  }
  if (payload.referer && payload.referer !== service.referer) {
    service.referer = payload.referer
    changed = true
  }
  if (payload.expires != null && payload.expires !== service.expires) {
    service.expires = payload.expires
    changed = true
  }
  if (Array.isArray(payload.extent) && payload.extent.length === 4) {
    const next = payload.extent.map(Number)
    const prev = Array.isArray(service.extent) ? service.extent : null
    if (!prev || next.some((value, index) => value !== Number(prev[index]))) {
      service.extent = next
      changed = true
    }
  }
  return changed
}
async function ensureOnlineLayerExtent(service) {
  if (!service?.serviceUrl) return null
  if (onlineLayerBounds(service)) return onlineLayerBounds(service)
  try {
    const info = await api('/api/overlay/arcgis-info', {
      serviceUrl: service.serviceUrl,
      token: service.token || '',
      referer: service.referer || '',
    })
    if (applyOnlineServiceMeta(service, info)) writeSavedOnlineLayers()
    if (onlineLayerBounds(service)) return onlineLayerBounds(service)
  } catch (error) {
    // Older preview builds may lack /api/overlay/arcgis-info; fall through to export.
    if (!/接口不存在/.test(error.message || '')) throw error
  }
  const seed = collectionBounds([{ features: allMapFeatures() }]) || {
    minX: 0, minY: 0, maxX: 1, maxY: 1,
  }
  await fetchOnlineOverlayImage(service, seed, 64, 64)
  return onlineLayerBounds(service)
}
async function fetchOnlineOverlayImage(service, bounds, width, height) {
  if (!service?.serviceUrl || !service?.layerName || !bounds) return null
  const crs = normalizeCrsInput(service.crs || suggestedOverlayCrs(bounds))
  const featureBounds = collectionBounds([{ features: allMapFeatures() }])
  if (featureBounds && !crsMatchesBounds(crs, featureBounds)) {
    throw new Error(
      looksGeographic(featureBounds)
        ? `当前成果是经纬度，请将坐标参考改为 EPSG:4490 或 EPSG:4326（现在是 ${crs}）`
        : `当前成果像是投影坐标（米），请用 EPSG:4528 等投影坐标系，不要用 ${crs}`
    )
  }
  let payload
  try {
    payload = await api('/api/overlay/online-map', {
      serviceUrl: service.serviceUrl,
      layerName: service.layerName,
      crs,
      token: service.token || '',
      referer: service.referer || '',
      username: service.username || '',
      bbox: [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY],
      width: Math.round(width),
      height: Math.round(height),
    })
  } catch (error) {
    if (error?.payload && applyOnlineServiceMeta(service, error.payload)) writeSavedOnlineLayers()
    throw error
  }
  if (crs !== service.crs) {
    service.crs = crs
    applyOnlineServiceMeta(service, payload)
    writeSavedOnlineLayers()
  } else if (applyOnlineServiceMeta(service, payload)) {
    writeSavedOnlineLayers()
  }
  return payload
}
function layerVisible(key) {
  return overlayState.layerVisibility[key] !== false
}
function setLayerVisible(key, visible) {
  overlayState.layerVisibility[key] = !!visible
}
async function boundsForLayerKey(key) {
  if (!key) return null
  if (key.startsWith('result:')) {
    const index = Number(key.slice('result:'.length))
    const feature = overlayState.result?.features?.[index]
    return feature ? collectionBounds([{ features: [feature] }]) : null
  }
  if (key.startsWith('local:')) {
    const id = key.slice('local:'.length)
    const layer = overlayState.localLayers.find(item => item.id === id)
    return layer ? collectionBounds([{ features: layer.features || [] }]) : null
  }
  if (key.startsWith('online:')) {
    const id = key.slice('online:'.length)
    const layer = overlayState.onlineLayers.find(item => item.id === id)
    if (!layer) return null
    try {
      return await ensureOnlineLayerExtent(layer) || onlineLayerBounds(layer)
    } catch {
      return onlineLayerBounds(layer)
    }
  }
  return null
}
async function locateLayerByKey(key) {
  const bounds = await boundsForLayerKey(key)
  if (!bounds) return false
  fitMapToDataBounds(bounds)
  return true
}
function revealResultLayers() {
  ;(overlayState.result?.features || []).forEach((_, index) => {
    overlayState.layerVisibility[`result:${index}`] = true
  })
}
function setAllOverlayLayers(visible) {
  ;(overlayState.result?.features || []).forEach((_, index) => setLayerVisible(`result:${index}`, visible))
  overlayState.localLayers.forEach(layer => setLayerVisible(`local:${layer.id}`, visible))
  overlayState.onlineLayers.forEach(layer => setLayerVisible(`online:${layer.id}`, visible))
}
function layerControlSelectionState() {
  const items = layerControlItems()
  if (!items.length) return { checked: false, indeterminate: false }
  const visibleCount = items.filter(item => layerVisible(item.key)).length
  return {
    checked: visibleCount === items.length,
    indeterminate: visibleCount > 0 && visibleCount < items.length,
  }
}
function syncLayerControlCheckboxes() {
  document.querySelectorAll('[data-layer-key]').forEach(node => {
    const key = node.getAttribute('data-layer-key')
    if (!key) return
    node.checked = layerVisible(key)
  })
  const master = document.querySelector('#overlay-layers-select-all')
  if (!master) return
  const state = layerControlSelectionState()
  master.checked = state.checked
  master.indeterminate = state.indeterminate
}
function allMapFeatures() {
  return [
    ...(overlayState.result?.features || []),
    ...overlayState.localLayers.flatMap(layer => layer.features || []),
  ]
}
function layerControlItems() {
  const items = []
  ;(overlayState.result?.features || []).forEach((feature, index) => {
    items.push({ key: `result:${index}`, label: `成果 · ${featureLabel(feature, index)}`, tone: 'result' })
  })
  overlayState.localLayers.forEach(layer => {
    items.push({ key: `local:${layer.id}`, label: `本地 · ${layer.name}`, tone: 'reference' })
  })
  overlayState.onlineLayers.forEach(layer => {
    items.push({ key: `online:${layer.id}`, label: `在线 · ${layer.name}`, tone: 'online' })
  })
  return items
}
function layerControlMarkup() {
  const items = layerControlItems()
  const open = !!overlayState.layerPanelOpen
  const icon = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 3.2 3 8l9 4.8L21 8l-9-4.8Zm0 7.1L4.2 6.4 12 2.3l7.8 4.1L12 10.3Zm0 2.1 9-4.8v2.4L12 17.1 3 10v-2.4l9 4.8Zm0 4.3 9-4.8v2.4L12 21.4 3 14.3v-2.4l9 4.8Z"/></svg>'
  const toggle = `<button type="button" id="overlay-layers-toggle" class="overlay-layer-toggle${open ? ' is-active' : ''}" title="图层" aria-label="图层" aria-expanded="${open ? 'true' : 'false'}" aria-controls="overlay-layer-panel">${icon}</button>`
  if (!items.length) {
    return `<div id="overlay-layer-panel" class="overlay-layer-panel" ${open ? '' : 'hidden'}><p class="muted overlay-layer-empty">暂无图层</p></div>${toggle}`
  }
  const selection = layerControlSelectionState()
  const master = `<label class="overlay-layer-select-all"><input type="checkbox" id="overlay-layers-select-all" ${selection.checked ? 'checked' : ''}>全选</label>`
  const list = master + items.map(item => `<label class="legend-${item.tone}"><input type="checkbox" data-layer-key="${escape(item.key)}" ${layerVisible(item.key) ? 'checked' : ''}>${escape(item.label)}</label>`).join('')
  return `<div id="overlay-layer-panel" class="overlay-layer-panel" ${open ? '' : 'hidden'}>${list}</div>${toggle}`
}
function localLayerListMarkup() {
  if (!overlayState.localLayers.length) return ''
  return `<ul class="overlay-source-list">${overlayState.localLayers.map(layer => `<li><button type="button" class="overlay-source-locate" data-locate-local="${escape(layer.id)}" title="定位到该图层"><strong>${escape(layer.name)}</strong><small>${(layer.features || []).length} 个要素 · 点击定位</small></button><button type="button" class="text-action" data-remove-local="${escape(layer.id)}">删除</button></li>`).join('')}</ul>`
}
function onlineLayerListMarkup() {
  if (!overlayState.onlineLayers.length) return ''
  return `<ul class="overlay-source-list">${overlayState.onlineLayers.map(layer => `<li><button type="button" class="overlay-source-locate" data-locate-online="${escape(layer.id)}" title="定位到该图层"><strong>${escape(layer.name || layer.layerName)}</strong><small title="${escape(layer.serviceUrl)}">序号 ${escape(layer.layerName)} · ${escape(layer.crs || 'EPSG:4326')}${layer.token ? ' · 已鉴权' : ''} · 点击定位</small></button><span class="overlay-source-actions"><button type="button" class="text-action" data-edit-online="${escape(layer.id)}">编辑</button><button type="button" class="text-action" data-remove-online="${escape(layer.id)}">删除</button></span></li>`).join('')}</ul>`
}
function openServiceModal(editId = null) {
  overlayState.serviceModalEditId = editId
  overlayState.serviceModalOpen = true
  refreshOverlayPanel()
}
function serviceModalDraft() {
  const editing = overlayState.onlineLayers.find(item => item.id === overlayState.serviceModalEditId)
  const bounds = collectionBounds([{ features: allMapFeatures() }])
  return {
    editing,
    serviceUrl: editing?.serviceUrl || '',
    name: editing?.name || '',
    layerName: editing?.layerName || '',
    crs: editing?.crs || suggestedOverlayCrs(bounds),
    username: editing?.username || '',
    token: editing?.token || '',
  }
}
function boundsToExtent(bounds) {
  if (!bounds) return null
  return [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]
}
function ensureOverlayProjection(crs, sampleBounds) {
  const code = normalizeCrsInput(crs || 'EPSG:4326')
  if (typeof ol === 'undefined') return code
  if (ol.proj.get(code)) return code
  const geographic = sampleBounds ? looksGeographic(sampleBounds) : /^(EPSG:)?(4326|4490|4214|4610)$/i.test(code)
  ol.proj.addProjection(new ol.proj.Projection({
    code,
    units: geographic ? 'degrees' : 'm',
    extent: geographic ? [-180, -90, 180, 90] : [0, 0, 60000000, 10000000],
  }))
  return code
}
function overlayMapProjectionCode() {
  const bounds = worldMapBounds()
  const online = overlayState.onlineLayers.find(layer => layerVisible(`online:${layer.id}`))
  return ensureOverlayProjection(online?.crs || suggestedOverlayCrs(bounds), bounds)
}
function vectorStyle(tone) {
  if (tone === 'result') {
    return new ol.style.Style({
      stroke: new ol.style.Stroke({ color: '#d92d20', width: 2.5 }),
      fill: new ol.style.Fill({ color: 'rgba(217,45,32,0.16)' }),
      image: new ol.style.Circle({
        radius: 4,
        fill: new ol.style.Fill({ color: '#d92d20' }),
        stroke: new ol.style.Stroke({ color: '#fff', width: 1 }),
      }),
    })
  }
  return new ol.style.Style({
    stroke: new ol.style.Stroke({ color: '#2f6fed', width: 2 }),
    fill: new ol.style.Fill({ color: 'rgba(47,111,237,0.14)' }),
    image: new ol.style.Circle({
      radius: 4,
      fill: new ol.style.Fill({ color: '#2f6fed' }),
      stroke: new ol.style.Stroke({ color: '#fff', width: 1 }),
    }),
  })
}
function featuresToVectorSource(features, projectionCode) {
  const source = new ol.source.Vector()
  if (!features?.length) return source
  const format = new ol.format.GeoJSON()
  source.addFeatures(format.readFeatures({
    type: 'FeatureCollection',
    features: features.map((feature, index) => ({
      type: 'Feature',
      id: feature.id || index,
      properties: feature.properties || {},
      geometry: feature.geometry,
    })),
  }, {
    dataProjection: projectionCode,
    featureProjection: projectionCode,
  }))
  return source
}
async function loadOnlineImageViaProxy(service, image, src) {
  const parsed = new URL(src, window.location.origin)
  const bboxParam = parsed.searchParams.get('BBOX') || parsed.searchParams.get('bbox')
  const sizeParam = parsed.searchParams.get('SIZE') || parsed.searchParams.get('size')
  if (!bboxParam || !sizeParam) throw new Error('在线服务请求参数无效')
  const bbox = bboxParam.split(',').map(Number)
  const size = sizeParam.split(',').map(Number)
  if (bbox.some(value => !Number.isFinite(value)) || size.some(value => !Number.isFinite(value))) {
    throw new Error('在线服务请求参数无效')
  }
  const crs = normalizeCrsInput(service.crs || suggestedOverlayCrs(boundsFromExtent(bbox)))
  const payload = await api('/api/overlay/online-map', {
    serviceUrl: service.serviceUrl,
    layerName: service.layerName,
    crs,
    token: service.token || '',
    referer: service.referer || '',
    username: service.username || '',
    bbox,
    width: Math.max(64, Math.min(2048, Math.round(size[0]))),
    height: Math.max(64, Math.min(2048, Math.round(size[1]))),
  })
  if (applyOnlineServiceMeta(service, payload)) writeSavedOnlineLayers()
  if (payload.warning) overlayState.onlineNote = payload.warning
  else overlayState.onlineNote = ''
  updateOverlayMapNote()
  const node = image.getImage()
  await new Promise((resolve, reject) => {
    node.onload = () => resolve()
    node.onerror = () => reject(new Error('在线服务图像无法显示'))
    node.src = `data:${payload.contentType || 'image/png'};base64,${payload.imageBase64}`
  })
}
function createOnlineOlLayer(service, projectionCode) {
  const isArcGis = /\/MapServer\b/i.test(service.serviceUrl || '')
  const imageLoadFunction = (image, src) => {
    loadOnlineImageViaProxy(service, image, src).catch(error => {
      overlayState.onlineNote = error.message || '在线服务套合失败'
      updateOverlayMapNote()
      try {
        image.setState(ol.ImageState?.ERROR ?? 3)
      } catch { /* ignore */ }
    })
  }
  const source = isArcGis
    ? new ol.source.ImageArcGISRest({
      url: String(service.serviceUrl || '').replace(/\/+$/, ''),
      params: {
        LAYERS: `show:${service.layerName}`,
        FORMAT: 'PNG32',
        TRANSPARENT: true,
      },
      ratio: 1.2,
      projection: projectionCode,
      imageLoadFunction,
    })
    : new ol.source.ImageWMS({
      url: String(service.serviceUrl || ''),
      params: {
        LAYERS: service.layerName,
        FORMAT: 'image/png',
        TRANSPARENT: true,
      },
      ratio: 1.2,
      projection: projectionCode,
      imageLoadFunction,
    })
  return new ol.layer.Image({
    source,
    opacity: 0.88,
    visible: layerVisible(`online:${service.id}`),
    properties: { overlayKey: `online:${service.id}`, serviceId: service.id },
  })
}
function disposeOverlayMap() {
  if (overlayState.map) {
    overlayState.map.setTarget(null)
    overlayState.map.dispose?.()
    overlayState.map = null
  }
}
function updateOverlayMapNote() {
  const note = document.querySelector('#overlay-map-note')
  if (!note) return
  const resultCount = (overlayState.result?.features || []).filter((_, index) => layerVisible(`result:${index}`)).length
  const localCount = overlayState.localLayers
    .filter(layer => layerVisible(`local:${layer.id}`))
    .reduce((sum, layer) => sum + (layer.features || []).length, 0)
  const visibleOnline = overlayState.onlineLayers.filter(layer => layerVisible(`online:${layer.id}`)).length
  const bounds = worldMapBounds()
  const plane = bounds && looksGeographic(bounds) ? '经纬度范围' : '本地平面坐标'
  const zoom = overlayState.map?.getView()?.getZoom()
  const zoomText = Number.isFinite(zoom) ? `缩放 ${zoom.toFixed(2)}×` : ''
  const onlineNote = overlayState.onlineNote
    || (visibleOnline ? `在线 ${visibleOnline} 层` : (overlayState.onlineLayers.length ? '在线图层已隐藏' : '未添加在线服务'))
  note.textContent = `成果 ${resultCount} · 本地 ${localCount} · ${onlineNote} · ${plane}${zoomText ? ` · ${zoomText}` : ''}`
}
function syncOverlayMapLayerVisibility() {
  const map = overlayState.map
  if (!map) return
  map.getLayers().forEach(layer => {
    const key = layer.get('overlayKey')
    if (!key) return
    layer.setVisible(layerVisible(key))
  })
  updateOverlayMapNote()
}
async function syncOverlayMap(options = {}) {
  const target = document.querySelector('#overlay-map')
  const note = document.querySelector('#overlay-map-note')
  if (!target) return
  if (typeof ol === 'undefined') {
    if (note) note.textContent = '地图组件未加载，请刷新页面'
    return
  }
  const visibleOnline = overlayState.onlineLayers.filter(layer => layerVisible(`online:${layer.id}`))
  for (const service of visibleOnline) {
    if (onlineLayerBounds(service)) continue
    try {
      await ensureOnlineLayerExtent(service)
    } catch { /* optional */ }
  }
  if (!overlayState.autoFittedOnline) overlayState.autoFittedOnline = {}
  const featureBounds = collectionBounds([{ features: allMapFeatures() }])
  for (const service of visibleOnline) {
    const layerBounds = onlineLayerBounds(service)
    if (!layerBounds || overlayState.autoFittedOnline[service.id]) continue
    if (featureBounds && boundsIntersect(featureBounds, layerBounds)) continue
    overlayState.autoFittedOnline[service.id] = true
    await ensureOverlayMapBuilt()
    fitMapToDataBounds(layerBounds)
    return
  }
  await ensureOverlayMapBuilt(options)
  updateOverlayMapNote()
}
async function ensureOverlayMapBuilt(options = {}) {
  const target = document.querySelector('#overlay-map')
  if (!target || typeof ol === 'undefined') return null
  const bounds = worldMapBounds()
  if (!bounds) {
    disposeOverlayMap()
    const note = document.querySelector('#overlay-map-note')
    if (note) note.textContent = '没有可绘制的几何。请确认成果含 GeoJSON，上传套合 SHP，或添加在线服务。'
    return null
  }
  const buildToken = ++overlayState.drawToken
  const projectionCode = overlayMapProjectionCode()
  const previousExtent = options.keepView && overlayState.map
    ? overlayState.map.getView().calculateExtent()
    : null
  disposeOverlayMap()
  const layers = []
  for (const service of overlayState.onlineLayers) {
    try {
      layers.push(createOnlineOlLayer(service, projectionCode))
    } catch (error) {
      overlayState.onlineNote = error.message || '在线服务图层创建失败'
    }
  }
  overlayState.localLayers.forEach(layer => {
    layers.push(new ol.layer.Vector({
      source: featuresToVectorSource(layer.features || [], projectionCode),
      style: vectorStyle('local'),
      properties: { overlayKey: `local:${layer.id}` },
      visible: layerVisible(`local:${layer.id}`),
    }))
  })
  ;(overlayState.result?.features || []).forEach((feature, index) => {
    layers.push(new ol.layer.Vector({
      source: featuresToVectorSource([feature], projectionCode),
      style: vectorStyle('result'),
      properties: { overlayKey: `result:${index}` },
      visible: layerVisible(`result:${index}`),
    }))
  })
  const view = new ol.View({
    projection: projectionCode,
    maxZoom: MAP_ZOOM_MAX,
    minZoom: 0,
  })
  if (buildToken !== overlayState.drawToken) return null
  const map = new ol.Map({
    target,
    layers,
    view,
    controls: [],
  })
  if (buildToken !== overlayState.drawToken) {
    map.setTarget(null)
    return null
  }
  overlayState.map = map
  const fitExtent = previousExtent && previousExtent.every(Number.isFinite)
    ? previousExtent
    : boundsToExtent(bounds)
  view.fit(fitExtent, { padding: [40, 40, 40, 40], duration: 0, maxZoom: MAP_ZOOM_MAX })
  map.on('moveend', () => updateOverlayMapNote())
  syncOverlayMapLayerVisibility()
  return map
}
function fitMapToDataBounds(targetBounds) {
  if (!targetBounds) return false
  const extent = boundsToExtent(targetBounds)
  if (!extent) return false
  const run = map => {
    map.getView().fit(extent, { padding: [48, 48, 48, 48], duration: 250, maxZoom: MAP_ZOOM_MAX })
    updateOverlayMapNote()
  }
  if (overlayState.map) {
    run(overlayState.map)
    return true
  }
  ensureOverlayMapBuilt().then(map => { if (map) run(map) })
  return true
}
function locateLocalLayer(id) {
  const layer = overlayState.localLayers.find(item => item.id === id)
  if (!layer) return
  setLayerVisible(`local:${id}`, true)
  syncLayerControlCheckboxes()
  syncOverlayMapLayerVisibility()
  const bounds = collectionBounds([{ features: layer.features || [] }])
  if (!bounds) return toast('该本地图层没有可定位的几何')
  fitMapToDataBounds(bounds)
  toast(`已定位到本地图层四至：${layer.name}`)
}
async function locateOnlineLayer(id) {
  const layer = overlayState.onlineLayers.find(item => item.id === id)
  if (!layer) return
  setLayerVisible(`online:${id}`, true)
  syncLayerControlCheckboxes()
  syncOverlayMapLayerVisibility()
  try {
    const bounds = await ensureOnlineLayerExtent(layer) || onlineLayerBounds(layer)
    if (!bounds) return toast('无法读取该在线图层四至，请确认 Token 后重试')
    await syncOverlayMap({ keepView: true })
    fitMapToDataBounds(bounds)
    toast(`已定位到在线图层四至：${layer.name || layer.layerName}`)
  } catch (error) {
    toast(error.message || '定位在线图层失败')
  }
}
function serviceModalMarkup() {
  if (!overlayState.serviceModalOpen) return ''
  const draft = serviceModalDraft()
  const editing = !!draft.editing
  return `<div class="overlay-modal-backdrop" id="overlay-service-modal" role="dialog" aria-modal="true" aria-labelledby="overlay-service-title"><div class="overlay-modal"><header><h3 id="overlay-service-title">${editing ? '编辑在线服务' : '添加在线服务'}</h3></header><label>服务地址<input id="overlay-service-url" value="${escape(draft.serviceUrl)}" placeholder="http://host/arcgis/rest/services/.../MapServer"></label><label>显示名称<input id="overlay-service-name" value="${escape(draft.name)}" placeholder="如：高标准农田"></label><label>图层序号<input id="overlay-service-layer" value="${escape(draft.layerName)}" placeholder="MapServer 填 0 或 0,1；WMS 可填服务图层名"></label><label>坐标参考<input id="overlay-service-crs" value="${escape(draft.crs)}" placeholder="EPSG:4528"></label><label>Token（可选）<input id="overlay-service-token" value="${escape(draft.token)}" placeholder="粘贴服务 Token"></label><p id="overlay-service-error" class="error" hidden></p><div class="overlay-modal-actions"><button type="button" class="secondary" id="overlay-service-cancel">取消</button><button type="button" class="primary" id="overlay-service-save">${editing ? '保存修改' : '保存并套合'}</button></div></div></div>`
}
function geometryModalMarkup() {
  const modal = overlayState.geometryModal
  if (!modal) return ''
  return `<div class="overlay-modal-backdrop" id="geometry-view-modal" role="dialog" aria-modal="true" aria-labelledby="geometry-view-title"><div class="overlay-modal overlay-modal-wide"><header class="geometry-view-head"><div><h3 id="geometry-view-title">${escape(modal.title || '几何图形')}</h3><p class="muted">共 ${(modal.features || []).length} 个要素</p></div><button type="button" class="geometry-view-close" id="geometry-view-close" aria-label="关闭">×</button></header><canvas id="geometry-view-canvas" width="860" height="480" aria-label="几何图形预览"></canvas></div></div>`
}
function overlayPanelMarkup() {
  const localPick = overlayState.localLayers.length
    ? '<button type="button" class="overlay-add-btn overlay-add-btn-compact" id="overlay-pick"><span class="overlay-add-title">＋ 继续上传</span></button>'
    : '<button type="button" class="overlay-add-btn" id="overlay-pick"><span class="overlay-add-title">上传本地图层</span><small>Shape ZIP · .shp/.shx/.dbf · GeoJSON</small></button>'
  const onlinePick = overlayState.onlineLayers.length
    ? '<button type="button" class="overlay-add-btn overlay-add-btn-compact" id="overlay-service-open"><span class="overlay-add-title">＋ 继续添加</span></button>'
    : '<button type="button" class="overlay-add-btn" id="overlay-service-open"><span class="overlay-add-title">添加在线服务</span><small>显示名称用于图例；图层序号用于拉图</small></button>'
  return `<section class="overlay-panel"><header class="overlay-panel-head"><div><h3>成果展示</h3></div></header><div class="overlay-layout"><div class="overlay-map-pane"><div class="overlay-map-frame"><div id="overlay-map" role="img" aria-label="红线成果套合图"></div><div class="overlay-zoom-control" role="group" aria-label="地图缩放"><button type="button" id="overlay-zoom-in" title="放大" aria-label="放大">+</button><button type="button" id="overlay-zoom-out" title="缩小" aria-label="缩小">−</button><button type="button" id="overlay-zoom-reset" title="复位" aria-label="复位">↺</button></div><div class="overlay-layer-control" role="group" aria-label="图层显示控制">${layerControlMarkup()}</div></div><p id="overlay-map-note" class="muted overlay-map-note"></p></div><aside class="overlay-side"><section class="overlay-card"><header class="overlay-card-head"><h4>本地数据上传</h4><span class="overlay-card-tag">SHP / GeoJSON</span></header><input id="overlay-upload" type="file" hidden accept=".zip,.shp,.shx,.dbf,.prj,.cpg,.geojson,.json" multiple>${localPick}${localLayerListMarkup()}</section><section class="overlay-card"><header class="overlay-card-head"><h4>在线服务配置</h4><span class="overlay-card-tag">WMS / ArcGIS</span></header>${onlinePick}${onlineLayerListMarkup()}</section></aside></div>${serviceModalMarkup()}${geometryModalMarkup()}</section>`
}
function resetMapView() {
  const bounds = worldMapBounds()
  if (bounds) fitMapToDataBounds(bounds)
  else if (overlayState.map) {
    overlayState.map.getView().setZoom(1)
    updateOverlayMapNote()
  }
}
function applyMapZoom(delta) {
  const map = overlayState.map
  if (!map) return
  const view = map.getView()
  const zoom = view.getZoom()
  if (!Number.isFinite(zoom)) return
  view.animate({ zoom: Math.min(MAP_ZOOM_MAX, Math.max(0, zoom + delta)), duration: 160 })
}
function readSavedOnlineLayers() {
  try {
    const raw = localStorage.getItem(ONLINE_LAYERS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(item => item && typeof item.serviceUrl === 'string' && typeof item.layerName === 'string').map((item, index) => ({
      id: typeof item.id === 'string' ? item.id : `online-${index}`,
      name: item.name || item.layerName,
      serviceUrl: item.serviceUrl,
      layerName: item.layerName,
      crs: typeof item.crs === 'string' && item.crs ? item.crs : 'EPSG:4326',
      username: typeof item.username === 'string' ? item.username : '',
      token: typeof item.token === 'string' ? item.token : '',
      referer: typeof item.referer === 'string' ? item.referer : '',
      expires: typeof item.expires === 'number' ? item.expires : null,
      extent: Array.isArray(item.extent) && item.extent.length === 4 ? item.extent.map(Number) : null,
    }))
  } catch {
    return []
  }
}
function writeSavedOnlineLayers() {
  try {
    localStorage.setItem(ONLINE_LAYERS_KEY, JSON.stringify(overlayState.onlineLayers.map(layer => ({
      id: layer.id,
      name: layer.name,
      serviceUrl: layer.serviceUrl,
      layerName: layer.layerName,
      crs: layer.crs || 'EPSG:4326',
      username: layer.username || '',
      token: layer.token || '',
      referer: layer.referer || '',
      expires: layer.expires ?? null,
      extent: Array.isArray(layer.extent) && layer.extent.length === 4 ? layer.extent : null,
    }))))
  } catch { /* private mode */ }
}
async function ensureMapConfig() {
  if (!overlayState.mapConfig) {
    try {
      overlayState.mapConfig = await api('/api/map-config')
    } catch {
      overlayState.mapConfig = { onlineEnabled: true, proxy: true, defaultCrs: 'EPSG:4326' }
    }
  }
  if (!overlayState.onlineLayers.length) {
    const saved = readSavedOnlineLayers()
    if (saved.length) overlayState.onlineLayers = saved
  }
  return overlayState.mapConfig
}
function paintFeaturesOnCanvas(canvas, features, noteNode) {
  const ctx = canvas.getContext('2d')
  const width = canvas.width
  const height = canvas.height
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#f4f7fc'
  ctx.fillRect(0, 0, width, height)
  const bounds = collectionBounds([{ features }])
  if (!bounds) {
    if (noteNode) noteNode.textContent = '没有可绘制的几何'
    return
  }
  const geographic = looksGeographic(bounds)
  const padding = 28
  features.forEach(feature => {
    drawGeometry(ctx, feature.geometry, bounds, width, height, padding, geographic, {
      stroke: '#d92d20',
      fill: 'rgba(217,45,32,0.16)',
      lineWidth: 2.5,
      pointRadius: 4,
    })
  })
  if (noteNode) noteNode.textContent = `${features.length} 个要素 · ${geographic ? '经纬度范围' : '本地平面坐标'}`
}
function openGeometryModal(title, features) {
  overlayState.geometryModal = { title, features: features || [] }
  refreshOverlayPanel()
  requestAnimationFrame(() => {
    const canvas = document.querySelector('#geometry-view-canvas')
    if (canvas) paintFeaturesOnCanvas(canvas, overlayState.geometryModal.features)
  })
}
function refreshOverlayPanel() {
  const host = document.querySelector('#result-overlay')
  if (!host) return
  disposeOverlayMap()
  host.innerHTML = overlayPanelMarkup()
  bindOverlayPanel()
  syncLayerControlCheckboxes()
  syncOverlayMap()
  if (overlayState.geometryModal) {
    requestAnimationFrame(() => {
      const canvas = document.querySelector('#geometry-view-canvas')
      if (canvas) paintFeaturesOnCanvas(canvas, overlayState.geometryModal.features)
    })
  }
}
function bindOverlayPanel() {
  const pick = document.querySelector('#overlay-pick')
  const upload = document.querySelector('#overlay-upload')
  if (pick && upload) {
    pick.onclick = () => upload.click()
    upload.onchange = async event => {
      const files = Array.from(event.target.files || [])
      upload.value = ''
      if (!files.length) return
      try {
        const encoded = await Promise.all(files.map(file => new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve({ name: file.name, content: String(reader.result).split(',')[1] })
          reader.onerror = () => reject(new Error('套合文件读取失败'))
          reader.readAsDataURL(file)
        })))
        const collection = await api('/api/overlay/parse', { files: encoded })
        const id = `local-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
        const name = files.length === 1 ? files[0].name : `${files[0].name} 等 ${files.length} 个文件`
        overlayState.localLayers.push({ id, name, features: collection.features || [] })
        setLayerVisible(`local:${id}`, true)
        refreshOverlayPanel()
        toast(`已添加本地图层，共 ${(collection.features || []).length} 个要素`)
      } catch (error) {
        toast(error.message || '套合数据加载失败')
      }
    }
  }
  document.querySelectorAll('[data-locate-local]').forEach(node => {
    node.onclick = () => locateLocalLayer(node.dataset.locateLocal)
  })
  document.querySelectorAll('[data-locate-online]').forEach(node => {
    node.onclick = () => locateOnlineLayer(node.dataset.locateOnline)
  })
  document.querySelectorAll('[data-remove-local]').forEach(node => {
    node.onclick = event => {
      event.stopPropagation()
      const id = node.dataset.removeLocal
      overlayState.localLayers = overlayState.localLayers.filter(layer => layer.id !== id)
      delete overlayState.layerVisibility[`local:${id}`]
      refreshOverlayPanel()
      toast('已删除本地图层')
    }
  })
  document.querySelectorAll('[data-edit-online]').forEach(node => {
    node.onclick = event => {
      event.stopPropagation()
      openServiceModal(node.dataset.editOnline)
    }
  })
  document.querySelectorAll('[data-remove-online]').forEach(node => {
    node.onclick = event => {
      event.stopPropagation()
      const id = node.dataset.removeOnline
      overlayState.onlineLayers = overlayState.onlineLayers.filter(layer => layer.id !== id)
      delete overlayState.layerVisibility[`online:${id}`]
      writeSavedOnlineLayers()
      refreshOverlayPanel()
      toast('已删除在线服务')
    }
  })
  document.querySelectorAll('[data-layer-key]').forEach(node => {
    node.addEventListener('change', async () => {
      const key = node.getAttribute('data-layer-key')
      if (!key) return
      setLayerVisible(key, node.checked)
      syncLayerControlCheckboxes()
      syncOverlayMapLayerVisibility()
      if (node.checked) await locateLayerByKey(key)
    })
  })
  document.querySelector('#overlay-layers-select-all')?.addEventListener('change', event => {
    const master = event.currentTarget
    setAllOverlayLayers(!!master.checked)
    syncLayerControlCheckboxes()
    syncOverlayMapLayerVisibility()
    toast(master.checked ? '已全选图层' : '已取消全选')
  })
  document.querySelector('#overlay-layers-toggle')?.addEventListener('click', () => {
    overlayState.layerPanelOpen = !overlayState.layerPanelOpen
    const panel = document.querySelector('#overlay-layer-panel')
    const toggle = document.querySelector('#overlay-layers-toggle')
    if (panel) panel.hidden = !overlayState.layerPanelOpen
    if (toggle) {
      toggle.classList.toggle('is-active', overlayState.layerPanelOpen)
      toggle.setAttribute('aria-expanded', overlayState.layerPanelOpen ? 'true' : 'false')
    }
  })
  document.querySelector('#overlay-zoom-in')?.addEventListener('click', () => applyMapZoom(1))
  document.querySelector('#overlay-zoom-out')?.addEventListener('click', () => applyMapZoom(-1))
  document.querySelector('#overlay-zoom-reset')?.addEventListener('click', () => resetMapView())
  document.querySelector('#overlay-service-open')?.addEventListener('click', () => openServiceModal(null))
  const closeServiceModal = () => {
    overlayState.serviceModalOpen = false
    overlayState.serviceModalEditId = null
    refreshOverlayPanel()
  }
  document.querySelector('#overlay-service-cancel')?.addEventListener('click', closeServiceModal)
  document.querySelector('#overlay-service-modal')?.addEventListener('click', event => {
    if (event.target?.id === 'overlay-service-modal') closeServiceModal()
  })
  document.querySelector('#overlay-service-save')?.addEventListener('click', async () => {
    const serviceUrl = document.querySelector('#overlay-service-url')?.value.trim() || ''
    const displayName = document.querySelector('#overlay-service-name')?.value.trim() || ''
    const layerName = document.querySelector('#overlay-service-layer')?.value.trim() || ''
    const crs = normalizeCrsInput(document.querySelector('#overlay-service-crs')?.value || 'EPSG:4326')
    let token = document.querySelector('#overlay-service-token')?.value.trim() || ''
    let expires = null
    const editId = overlayState.serviceModalEditId
    const existing = overlayState.onlineLayers.find(item => item.id === editId)
    const showModalError = message => {
      const node = document.querySelector('#overlay-service-error')
      if (node) {
        node.hidden = false
        node.textContent = message
      }
      toast(message)
    }
    const errorNode = document.querySelector('#overlay-service-error')
    if (errorNode) {
      errorNode.hidden = true
      errorNode.textContent = ''
    }
    if (!/^https?:\/\//i.test(serviceUrl)) return showModalError('请填写有效的服务地址（http/https）')
    if (!layerName) return showModalError('请填写图层序号')
    if (/\/MapServer\b/i.test(serviceUrl)) {
      const ids = layerName.replace(/^show:/i, '').split(',').map(part => part.trim()).filter(Boolean)
      if (!ids.length || ids.some(part => !/^\d+$/.test(part))) {
        return showModalError('ArcGIS MapServer 请填写图层序号，例如 0 或 0,1')
      }
    }
    const bounds = collectionBounds([{ features: allMapFeatures() }])
    if (bounds && !crsMatchesBounds(crs, bounds)) {
      return showModalError(
        looksGeographic(bounds)
          ? `当前成果是经纬度，请改用 EPSG:4490 / 4326（现在是 ${crs}）`
          : `当前成果像投影坐标，请改用 ${suggestedOverlayCrs(bounds)} 等，不要用 ${crs}`
      )
    }
    const saveButton = document.querySelector('#overlay-service-save')
    if (saveButton) saveButton.disabled = true
    try {
      const referer = existing?.referer || ''
      // Empty token field means clear auth; do not keep the previous token.
      if (token && existing && existing.expires != null) expires = existing.expires
      const record = {
        id: existing?.id || `online-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        name: displayName || layerName,
        serviceUrl,
        layerName,
        crs,
        username: '',
        token,
        referer,
        expires,
      }
      if (existing) {
        Object.assign(existing, record)
      } else {
        overlayState.onlineLayers.push(record)
      }
      setLayerVisible(`online:${record.id}`, true)
      revealResultLayers()
      overlayState.serviceModalOpen = false
      overlayState.serviceModalEditId = null
      overlayState.rasterCache = null
      writeSavedOnlineLayers()
      try {
        await ensureOnlineLayerExtent(record)
      } catch {
        /* locate can fetch later */
      }
      refreshOverlayPanel()
      const focus = collectionBounds([{ features: allMapFeatures() }]) || onlineLayerBounds(record)
      if (focus) fitMapToDataBounds(focus)
      toast(existing
        ? (token ? '在线服务已更新（已带鉴权）；点列表「定位」可跳到该服务四至' : '在线服务已更新；点列表「定位」可跳到该服务四至')
        : (token ? '在线服务已添加（已带鉴权）；点列表「定位」可跳到该服务四至' : '在线服务已添加；点列表「定位」可跳到该服务四至'))
    } catch (error) {
      showModalError(error.message || '在线服务保存失败')
      if (saveButton) saveButton.disabled = false
    }
  })
  document.querySelector('#geometry-view-close')?.addEventListener('click', () => {
    overlayState.geometryModal = null
    refreshOverlayPanel()
  })
  document.querySelector('#geometry-view-modal')?.addEventListener('click', event => {
    if (event.target?.id === 'geometry-view-modal') {
      overlayState.geometryModal = null
      refreshOverlayPanel()
    }
  })
}
async function loadResultGeojson(task) {
  for (let index = 0; index < task.outputs.length; index++) {
    const name = task.outputs[index]
    if (!/\.(geojson|json)$/i.test(name)) continue
    const response = await authenticatedFetch(`api/tasks/${task.id}/files/${index}`)
    if (!response.ok) throw new Error('读取成果失败')
    const length = Number(response.headers.get('content-length') || 0)
    if (length > 8 * 1024 * 1024) throw new Error('成果 GeoJSON 过大，请下载后在 GIS 中查看')
    return parseFeatureCollection(await response.text())
  }
  for (let index = 0; index < task.outputs.length; index++) {
    const name = task.outputs[index]
    if (!/\.zip$/i.test(name)) continue
    const response = await authenticatedFetch(`api/tasks/${task.id}/files/${index}`)
    if (!response.ok) throw new Error('读取成果失败')
    const length = Number(response.headers.get('content-length') || 0)
    if (length > 32 * 1024 * 1024) throw new Error('成果 ZIP 过大，无法页内套合')
    const buffer = await response.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunk = 0x8000
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
    }
    const collection = await api('/api/overlay/parse', { files: [{ name, content: btoa(binary) }] })
    return { type: 'FeatureCollection', features: collection.features || [] }
  }
  return null
}
async function loadResultOverlay(task) {
  const host = document.querySelector('#result-overlay')
  if (!host || task?.state !== 'succeeded') return
  if (overlayState.taskId !== task.id) {
    overlayState.taskId = task.id
    overlayState.result = null
    overlayState.localLayers = []
    overlayState.layerVisibility = {}
    overlayState.serviceModalOpen = false
    overlayState.serviceModalEditId = null
    overlayState.geometryModal = null
    overlayState.rasterCache = null
    resetMapView()
  }
  await ensureMapConfig()
  try {
    overlayState.result = await loadResultGeojson(task) || { type: 'FeatureCollection', features: [] }
    revealResultLayers()
    ;(overlayState.result.features || []).forEach((_, index) => setLayerVisible(`result:${index}`, true))
    refreshOverlayPanel()
    const focus = collectionBounds([{ features: overlayState.result.features || [] }])
    if (focus) requestAnimationFrame(() => fitMapToDataBounds(focus))
  } catch (error) {
    host.innerHTML = `<section class="overlay-panel"><h3>成果展示</h3><p class="error">${escape(error.message || '套合准备失败')}</p></section>`
  }
}
function bindPreviewGeometryButtons() {
  document.querySelectorAll('[data-preview-geometry]').forEach(node => {
    node.onclick = () => {
      const entry = previewGeometryCollections[Number(node.dataset.previewGeometry)]
      if (!entry) return toast('没有可查看的几何')
      const featureIndex = node.dataset.previewFeature
      if (featureIndex != null && featureIndex !== '') {
        const feature = entry.features?.[Number(featureIndex)]
        if (!feature) return toast('没有可查看的几何')
        openGeometryModal(`${entry.name} · ${featureLabel(feature, Number(featureIndex))}`, [feature])
        return
      }
      openGeometryModal(entry.name, entry.features)
    }
  })
}
async function loadResultPreviews(task) {
  const host = document.querySelector('#result-preview')
  if (!host || task?.state !== 'succeeded') return
  previewGeometryCollections = []
  await loadResultOverlay(task)
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
  if (!parts.length && overlayState.result?.features?.length) {
    parts.push(geojsonPreviewMarkup('提取成果几何', JSON.stringify({
      type: 'FeatureCollection',
      features: overlayState.result.features,
    })))
  }
  host.innerHTML = parts.length ? `<h3>成果预览</h3>${parts.join('')}` : '<p class="muted">当前成果为压缩包或二进制，请下载后用 GIS 软件打开。</p>'
  bindPreviewGeometryButtons()
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
    ['02 / 成果套合', '成果展示', '成果预览可点「查看」弹框看几何。其下方为套合地图：可多次上传本地图层、弹框添加在线服务，列表可删除；地图右上角按已有图层开关显示隐藏。', null],
    ['03 / 任务与成果', '任务与成果', '关闭网页后任务仍由专家服务处理。桌面端下载走原生另存为。取消会终止处理进程且不发布成果。', null],
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
  main.querySelectorAll('[data-delete]').forEach(node => node.onclick = async event => {
    event.stopPropagation()
    if (!confirm('删除此任务记录及其文件？删除后无法恢复。')) return
    try {
      await api(`/api/tasks/${node.dataset.delete}/delete`, {})
      if (selectedTask === node.dataset.delete) selectedTask = undefined
      currentPage = 'history'
      await refresh()
      toast('任务已删除')
    } catch (error) { toast(error.message) }
  })
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
    sessionExpired = false
    const ticket = new URLSearchParams(location.hash.slice(1)).get('ticket')
      || (typeof window.__LOCAL_FIXTURE_TICKET__ === 'string' ? window.__LOCAL_FIXTURE_TICKET__ : null)
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
