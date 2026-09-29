const formats = '.docx,.pdf,.xlsx,.xlsm,.txt,.md,.csv,.tsv,.json,.yaml,.yml'
const tools = [
  { id: 'summary', name: '文档摘要与要点提取', description: '读取一份或多份材料，提炼摘要、重点、风险、时间节点和待办事项。', accept: formats, multiple: true,
    params: [['focus', '关注内容', null, '综合摘要、核心观点、关键事实、风险与问题、时间节点、待办事项、来源说明'], ['detail', '摘要详细程度', ['精简', '标准', '详细'], '标准'], ['requirements', '补充要求', null, '']] },
  { id: 'compare', name: '文档对比助手', description: '第一份为原始版本，第二份为新版本，比较可提取文字。', accept: formats, multiple: true,
    params: [['scope', '对比范围', null, '新增内容、删除内容、修改内容、数字变化、日期变化、名称或主体变化、重点变化摘要'], ['requirements', '补充要求', null, '']] },
]
const main = document.querySelector('#main')
let currentPage = 'home', selectedTool, selectedFiles = [], options = {}, tasks = [], timer, toastTimer, busy = false
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
let sessionExpired = false
function showExpiredSession() {
  main.innerHTML = '<section class="panel"><h1>登录已失效</h1><p>请关闭当前 Tab，从桌面专家库重新打开。</p></section>'
}
function expireSession() {
  sessionExpired = true
  clearInterval(timer)
  tasks = []; selectedFiles = []; options = {}
  resultPreviews.clear()
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
let selectedTask
const stateLabels = { queued: '等待处理', running: '正在处理', succeeded: '已完成', failed: '处理失败', cancelled: '已取消' }
const resultPreviews = new Map()
function markdownMarkup(text) {
  const inline = value => escape(value.replace(/<source\s+index="(\d+)"\s+name="([^"]*)"\s*>/gi, '来源 $1：$2').replace(/<\/source>/gi, ''))
    .replace(/&lt;sup&gt;([\d,，\s]+)&lt;\/sup&gt;/gi, '<sup class="doc-source">[$1]</sup>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
  const lines = text.split(/\r?\n/), output = []
  const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'))
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (line.includes('|') && index + 1 < lines.length && cells(lines[index + 1]).every(cell => /^:?-{3,}:?$/.test(cell))) {
      const headers = cells(line), rows = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        const row = cells(lines[index++])
        rows.push(`<tr>${headers.map((_, column) => `<td>${inline(row[column] || '')}</td>`).join('')}</tr>`)
      }
      index--
      output.push(`<div class="doc-table-wrap"><table><thead><tr>${headers.map(cell => `<th scope="col">${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`)
      continue
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      const level = heading[1].length + 1
      output.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }
    const item = /^\s*(?:([-*])|\d+[.)])\s+(.+)$/.exec(line)
    if (item) {
      const tag = item[1] ? 'ul' : 'ol', items = []
      const pattern = tag === 'ul' ? /^\s*[-*]\s+(.+)$/ : /^\s*\d+[.)]\s+(.+)$/
      while (index < lines.length && pattern.test(lines[index])) items.push(`<li>${inline(pattern.exec(lines[index++])[1])}</li>`)
      index--
      output.push(`<${tag}>${items.join('')}</${tag}>`)
      continue
    }
    if (/^\s*---+\s*$/.test(line)) output.push('<hr>')
    else if (line.trim()) output.push(`<p>${inline(line)}</p>`)
  }
  return `<div class="doc-markdown">${output.join('')}</div>`
}
function summarySectionsMarkup(preview) {
  const chunks = preview.text.split(/^##\s+/m).filter(Boolean)
  return `<div class="doc-summary-sections">${chunks.map(chunk => {
    const [heading, ...body] = chunk.split(/\r?\n/)
    return `<section><h3>${escape(heading?.replace(/^#\s+/, '') || '处理摘要')}</h3>${markdownMarkup(body.join('\n'))}</section>`
  }).join('')}</div>${preview.truncated ? '<p class="muted">网页仅预览前 3 万字符，请下载完整成果。</p>' : ''}`
}
function toolIcon(id) {
  return `/assets/${['summary', 'compare'].includes(id) ? id : 'history'}.png`
}
function emptyMarkup(kind) {
  const records = kind === 'history'
  return `<div class="doc-empty"><img src="/assets/${records ? 'history' : 'files'}.png" alt=""><strong>${records ? '暂无处理记录' : '暂无成果文件'}</strong><p>${records ? '新建任务后，处理状态和结果会显示在这里。' : '完成任务后，可在这里下载当前用户的实际成果。'}</p><button class="primary" data-tool="summary">新建处理</button></div>`
}
function historyMarkup() {
  return tasks.length ? `<div class="history-list">${tasks.map(task => `<button class="history-row" data-task="${escape(task.id)}"><img src="${toolIcon(task.tool)}" alt=""><span><strong>${escape(task.options.taskName || task.options.title || tools.find(tool => tool.id === task.tool)?.name || task.tool)}</strong><small>${escape(new Date(task.created * 1000).toLocaleString())} · ${task.inputs.length} 个文件 · ${escape(tools.find(tool => tool.id === task.tool)?.name || task.tool)}</small></span><em class="${escape(task.state)}">${escape(stateLabels[task.state] || task.state)}</em></button>`).join('')}</div>` : emptyMarkup('history')
}
function filesMarkup() {
  const files = tasks.filter(task => task.state === 'succeeded').flatMap(task => task.outputs.map((name, index) => ({ task, name, index })))
  return files.length ? `<div class="outputs">${files.map(({ task, name, index }) => `<div><span><strong>${escape(name)}</strong><small>${escape(task.options.taskName || task.options.title || tools.find(tool => tool.id === task.tool)?.name || task.tool)}</small></span><a class="primary" href="/api/tasks/${escape(task.id)}/files/${index}" download>下载文件</a></div>`).join('')}</div>` : emptyMarkup('files')
}
function taskMarkup() {
  const task = tasks.find(item => item.id === selectedTask)
  if (!task) return '<h1>任务暂不可用</h1><p class="muted">记录可能已超过保留期限，请返回任务记录查看。</p>'
  const tool = tools.find(item => item.id === task.tool)
  const isCompare = task.tool === 'compare'
  const title = escape(task.options.taskName || task.options.title || tool?.name || task.tool)
  const inputs = task.input_names?.length ? task.input_names : task.inputs
  const details = `<dl class="doc-details"><dt>任务名称</dt><dd>${title}</dd><dt>任务类型</dt><dd>${escape(tool?.name || task.tool)}</dd><dt>创建时间</dt><dd>${escape(new Date(task.created * 1000).toLocaleString())}</dd><dt>${isCompare ? '基准／对比版本' : '上传文件'}</dt><dd>${inputs.map(name => escape(name)).join('<br>')}</dd></dl>`
  const back = '<button class="doc-back" data-page="history">← 返回处理记录</button>'
  const active = task.state === 'queued' || task.state === 'running'
  const success = task.state === 'succeeded'
  const frame = body => `<div class="doc-flow">${back}<div class="stepbar"><span>1 准备材料</span><span>2 核对信息</span><span class="current">3 处理与交付</span></div><header class="doc-result-head"><span>${escape(tool?.name || task.tool)}</span><h2>${title}</h2><p>${escape(new Date(task.created * 1000).toLocaleString())} · ${inputs.length} 个输入文件</p></header><section class="doc-result ${escape(task.state)}"><header class="doc-result-status"><div><small>真实任务状态</small><h3>${escape(stateLabels[task.state] || task.state)}</h3></div></header>${task.error ? `<p class="error doc-result-error">${escape(task.error)}</p>` : ''}${body}<h3>真实成果文件</h3><div class="doc-result-files">${success && task.outputs.length ? task.outputs.map((name, index) => `<div><span>${escape(name)}</span><a class="primary" href="/api/tasks/${escape(task.id)}/files/${index}" download>下载文件</a></div>`).join('') : '<p class="muted">尚未找到符合本任务要求的成果文件。</p>'}</div>${isCompare ? '<p class="doc-result-limit">文本内容对比不等同于视觉版式或 Word 修订比较。</p>' : ''}</section><details class="doc-task-details"><summary>任务详情</summary>${details}</details><div class="actions">${active ? `<button class="secondary" data-cancel="${escape(task.id)}">取消任务</button>` : !success ? `<button class="primary" data-tool="${isCompare ? 'compare' : 'summary'}">重新创建任务</button>` : ''}<button class="secondary" data-page="history">查看处理记录</button></div></div>`
  if (!success) return frame('')
  const preview = resultPreviews.get(task.id)
  const summaryMarkup = preview && !isCompare ? summarySectionsMarkup(preview) : undefined
  const previewMarkup = preview === undefined ? '<p class="muted">正在读取本次任务的结果预览…</p>' : preview === null ? '<p class="muted">网页预览暂不可读，请下载实际生成的成果文件核对。</p>' : isCompare ? `<div class="doc-diff-stats">${[['新增',preview.counts.added],['删除',preview.counts.deleted],['修改',preview.counts.modified],['未变化',preview.counts.unchanged]].map(([label,count]) => `<span><b>${escape(count)}</b>${label}</span>`).join('')}</div><h3>关键差异</h3><div class="doc-change-list">${preview.changes.slice(0, 100).map((change, index) => `<article class="${['added','deleted','modified'].includes(change.type) ? change.type : 'unknown'}"><strong>${escape({added:'新增',deleted:'删除',modified:'修改'}[change.type] || change.type)} ${index + 1}</strong>${change.old.length ? `<p><small>原内容</small>${escape(change.old.join(' / '))}</p>` : ''}${change.new.length ? `<p><small>新内容</small>${escape(change.new.join(' / '))}</p>` : ''}</article>`).join('') || '<p>两份文档提取后的文本内容一致。</p>'}${preview.changes.length > 100 ? '<p class="muted">网页仅预览前 100 项差异；请下载完整成果。</p>' : ''}</div>` : `<pre class="doc-summary-text">${escape(preview.text)}</pre>`
  const analysisMarkup = isCompare && typeof preview?.analysis?.text === 'string'
    ? `<section class="doc-result-body"><h2>重点变化分析（模型生成）</h2>${summarySectionsMarkup({ text: preview.analysis.text.slice(0, 30000), truncated: preview.analysis.text.length > 30000 })}<p class="muted">模型分析不改变逐行差异统计；重要结论请回到原文核对。</p></section>` : ''
  return frame(`<section class="doc-result-body">${summaryMarkup ?? previewMarkup}</section>${analysisMarkup}`)
}
async function loadResultPreview(task) {
  if (task?.state !== 'succeeded' || resultPreviews.has(task.id)) return
  const index = task.outputs.findIndex(name => task.tool === 'compare' ? name === '文档差异.json' : name === '文档摘要与要点.md')
  if (index < 0) { resultPreviews.set(task.id, null); render(); return }
  resultPreviews.set(task.id, undefined)
  try {
    const response = await authenticatedFetch(`/api/tasks/${encodeURIComponent(task.id)}/files/${index}`)
    if (!response.ok || Number(response.headers.get('content-length')) > 2 * 1024 * 1024) throw new Error('preview unavailable')
    const raw = await response.text()
    if (sessionExpired) return
    if (raw.length > 2 * 1024 * 1024) throw new Error('preview too large')
    if (task.tool === 'compare') {
      const value = JSON.parse(raw)
      if (!value?.counts || !Array.isArray(value.changes) || ['added','deleted','modified','unchanged'].some(key => !Number.isSafeInteger(value.counts[key])) || value.changes.some(change => !Array.isArray(change.old) || !Array.isArray(change.new) || [...change.old, ...change.new].some(line => typeof line !== 'string'))) throw new Error('invalid comparison')
      resultPreviews.set(task.id, value)
    } else resultPreviews.set(task.id, { text: raw.slice(0, 30000), truncated: raw.length > 30000 })
  } catch { if (!sessionExpired) resultPreviews.set(task.id, null) }
  if (currentPage === 'result' && selectedTask === task.id) render()
}
function homeMarkup() {
  const recent = tasks.slice(0, 3)
  const recentRows = recent.length
    ? `<div class="history-list">${recent.map(task => `<button class="history-row" data-task="${escape(task.id)}"><img src="${toolIcon(task.tool)}" alt=""><span><strong>${escape(task.options.taskName || task.options.title || tools.find(tool => tool.id === task.tool)?.name || task.tool)}</strong><small>${escape(new Date(task.created * 1000).toLocaleString())} · ${task.inputs.length} 个文件</small></span><em class="${escape(task.state)}">${escape(stateLabels[task.state] || task.state)}</em></button>`).join('')}</div>`
    : '<div class="doc-empty"><svg class="ui-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><strong>暂无任务</strong><p>选择上方的处理任务，开始整理文档。</p></div>'
  return `<div class="doc-dashboard"><header class="doc-intro"><span>文档智能处理专家</span><h1>文档智能处理</h1><p>从材料中提取重要信息，或比较两个版本的内容变化。</p></header><section class="doc-tools">${tools.map(tool => {
    const summary = tool.id === 'summary'
    return `<article class="doc-tool"><img src="${toolIcon(tool.id)}" alt=""><h2>${escape(tool.name)}</h2><p>${summary ? '基于一份或多份材料提炼摘要、重点、风险和待办事项，帮助快速把握材料重点。' : '按原始版本和新版本的顺序比较两份文档，识别可提取文字的新增、删除和变化。'}</p><ul>${(summary ? ['支持多份材料', '可选择提取内容', '可补充关注要求'] : ['明确原始与新版顺序', '分类整理文字差异', '生成关键变化摘要']).map(item => `<li>${item}</li>`).join('')}</ul><button class="primary" data-tool="${tool.id}">${summary ? '开始提取' : '开始对比'}</button></article>`
  }).join('')}</section><aside class="doc-guide"><h2>工作台说明</h2><p>您可以发起文档摘要或版本对比任务。上传材料并设置要求后，系统会在这里显示真实处理状态。</p><p>完成后可在任务记录中查看并下载成果文件。重要结论请回到原文核对。</p></aside><aside class="doc-formats"><h2>支持的文件格式</h2><p>单次最多 30 个文件，合计不超过 32 MB；摘要最多 10 份材料。</p><div><span><strong>Word</strong><small>.docx</small></span><span><strong>PDF</strong><small>.pdf</small></span><span><strong>Excel</strong><small>.xlsx .xlsm</small></span><span><strong>文本</strong><small>.txt .md 等</small></span></div><p>扫描 PDF 需先 OCR；不支持旧版 .doc/.xls。</p></aside><section class="doc-recent"><div><h2>最近任务</h2><button class="text-action" data-page="history">查看全部</button></div><p>您发起的文档处理任务会在这里显示。</p>${recentRows}</section></div>`
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
  if (currentPage === 'result') { main.innerHTML = taskMarkup(); void loadResultPreview(tasks.find(task => task.id === selectedTask)) }
  if (currentPage === 'guide') main.innerHTML = '<div class="guide-page"><button class="text-action" data-page="home">← 返回首页</button><section class="guide-hero"><span class="eyebrow">使用指南</span><h1>让文档重点与版本变化一目了然</h1><p>准备材料，核对提交信息，查看处理结果并下载成果。</p><button class="primary" data-tool="summary">＋ 新建任务</button></section><div class="guide-grid"><section class="panel"><span>01 / 摘要任务</span><h2>摘要任务</h2><p>支持 DOCX、PDF、XLSX、XLSM 和常见 UTF-8 文本。最多 10 份材料，合计 6 万字符，不静默截断。扫描 PDF 需要先 OCR；服务端必须配置摘要模型。</p></section><section class="panel"><span>02 / 提交前核对</span><h2>提交前核对</h2><p>核对所选文件、任务名称和处理选项，再确认提交。任务进度、记录与成果均可在当前专家工作台查看。</p></section><section class="panel"><span>03 / 对比任务</span><h2>对比任务</h2><p>请选择两份材料，第一份是原始版本，第二份是新版本。不比较版式、图片、批注和修订痕迹。</p></section><section class="panel"><span>04 / 复核要求</span><h2>复核要求</h2><p>摘要为模型生成内容，重要数字、日期、责任主体和结论须回到原文核对。Excel 仅读取保存的单元格值，不重新计算公式。</p></section></div></div>'
  bind()
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
const focusChoices = ['综合摘要', '核心观点', '关键事实', '风险与问题', '时间节点', '待办事项', '来源说明']
let comparisonFiles = [null, null]
function comparisonUploadMarkup() {
  return ['基准版本', '对比版本'].map((label, index) => `<div class="version-upload"><strong>${index + 1} ${label}</strong><span>${index === 0 ? '原始文件' : '新版本文件'}</span><input id="version-file-${index}" type="file" hidden data-version="${index}" accept="${formats}"><button type="button" class="version-pick" data-version-pick="${index}"><img src="/assets/compare.png" alt="">选择${label}文件</button><small id="version-name-${index}">${escape(comparisonFiles[index]?.name || '点击选择文件，或拖入此区域')}</small></div>`).join('') + '<button type="button" class="secondary" id="swap-versions">⇄ 交换版本</button>'
}
function setComparisonFile(index, incoming) {
  const files = Array.from(incoming || [])
  if (files.length !== 1 || ![0, 1].includes(index)) { toast('每个版本请选择一份文件'); return false }
  const candidate = comparisonFiles.slice()
  candidate[index] = files[0]
  if (!selectFiles(candidate.filter(Boolean))) return false
  comparisonFiles = candidate
  updateComparisonNames()
  updateFileList()
  return true
}
function updateComparisonNames() {
  comparisonFiles.forEach((file, index) => { document.querySelector(`#version-name-${index}`).textContent = file?.name || '点击选择文件，或拖入此区域' })
}
function parameterMarkup(tool) {
  return tool.params.map(([key, label, values]) => {
    if (key === 'focus') return `<fieldset class="doc-focus"><legend>关注内容（可多选）</legend>${focusChoices.map(choice => `<label><input type="checkbox" data-focus="${choice}" ${String(options.focus || '').split('、').includes(choice) ? 'checked' : ''}><span>${choice}</span></label>`).join('')}</fieldset>`
    return `<label>${escape(label)}${values ? `<select data-param="${key}">${values.map(entry => `<option value="${escape(entry)}" ${entry === options[key] ? 'selected' : ''}>${escape(entry)}</option>`).join('')}</select>` : `<textarea data-param="${key}" rows="4" maxlength="4000">${escape(options[key] || '')}</textarea>`}</label>`
  }).join('') || '<p class="muted">比较可提取的文字内容，按新增、删除与修改分类。不比较版式、图片或修订痕迹。</p>'
}
function form(tool, preserve = false) {
  if (sessionExpired) { showExpiredSession(); return }
  selectedTool = tool
  if (!preserve) {
    selectedFiles = []
    comparisonFiles = [null, null]
    options = Object.fromEntries(tool.params.map(([key,,, value]) => [key, value]))
  }
  currentPage = 'form'
  updateNavigation()
  main.innerHTML = `<div class="doc-flow doc-prepare"><h1>${escape(tool.name)}</h1><p class="muted">${escape(tool.description)}</p><div class="stepbar"><span class="current">1 准备材料</span><span>2 核对信息</span><span>3 处理与交付</span></div><div class="formgrid"><section class="panel"><h2>${tool.id === 'compare' ? '上传两个版本' : '准备材料'}</h2><label>任务名称<input id="task-name" maxlength="180" value="${escape(options.taskName || '')}" placeholder="例如：项目评审材料摘要"></label>${tool.id === 'compare' ? '<div class="version-order"><span><b>1 基准版本</b><small>原始文件在前</small></span><span><b>2 对比版本</b><small>新版本在后</small></span></div>' : ''}<input id="upload" type="file" hidden accept="${tool.accept}" ${tool.multiple ? 'multiple' : ''}><button type="button" id="dropzone" class="dropzone doc-upload"><img src="/assets/summary.png" alt=""><strong>点击选择或拖入文档</strong><small>选择本次摘要需要分析的材料</small></button><button type="button" class="secondary" id="append-files">追加文件</button><input type="file" id="append-upload" hidden accept="${tool.accept}" ${tool.multiple ? 'multiple' : ''}><p class="muted">${tool.id === 'compare' ? '必须选择两份文件，基准版本在前、新版本在后。' : '摘要最多 10 份材料。'}总大小不超过 32 MB。</p><h3>已上传文件</h3><div id="filelist" class="filelist"></div></section><section class="panel"><h2>${tool.id === 'compare' ? '对比范围' : '分析要求'}</h2>${parameterMarkup(tool)}</section></div><div class="actions"><button class="secondary" id="back">返回工作台</button><button class="primary" id="review">核对任务信息</button></div></div>`
  document.querySelectorAll('[data-param]').forEach(node => { node.value = options[node.dataset.param] ?? '' })
  if (tool.id === 'compare') {
    document.querySelector('.version-order').innerHTML = comparisonUploadMarkup()
    document.querySelector('#dropzone').hidden = true
    document.querySelector('#append-files').hidden = true
    document.querySelectorAll('[data-version-pick]').forEach(node => {
      node.onclick = () => document.querySelector(`#version-file-${node.dataset.versionPick}`).click()
    })
    document.querySelectorAll('[data-version]').forEach(node => {
      node.onchange = event => { setComparisonFile(Number(node.dataset.version), event.target.files); event.target.value = '' }
      const area = node.parentElement
      area.ondragover = event => { event.preventDefault() }
      area.ondrop = event => { event.preventDefault(); setComparisonFile(Number(node.dataset.version), event.dataTransfer.files) }
    })
    document.querySelector('#swap-versions').onclick = () => {
      comparisonFiles.reverse()
      selectedFiles = comparisonFiles.filter(Boolean)
      updateComparisonNames()
      updateFileList()
    }
  }
  updateFileList()
  document.querySelector('#upload').onchange = event => {
    selectFiles(event.target.files)
  }
  document.querySelector('#task-name').oninput = event => { options.taskName = event.target.value }
  document.querySelector('#append-files').onclick = () => document.querySelector('#append-upload').click()
  document.querySelector('#append-upload').onchange = event => { selectFiles(event.target.files, true); event.target.value = '' }
  const dropzone = document.querySelector('#dropzone')
  dropzone.onclick = () => document.querySelector('#upload').click()
  dropzone.ondragover = event => { event.preventDefault(); dropzone.classList.add('dragging') }
  dropzone.ondragleave = event => { if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('dragging') }
  dropzone.ondrop = event => { event.preventDefault(); dropzone.classList.remove('dragging'); selectFiles(event.dataTransfer.files, true) }
  document.querySelectorAll('[data-param]').forEach(node => node.onchange = () => { options[node.dataset.param] = node.value })
  document.querySelectorAll('[data-focus]').forEach(node => node.onchange = () => {
    options.focus = Array.from(document.querySelectorAll('[data-focus]')).filter(item => item.checked).map(item => item.dataset.focus).join('、')
  })
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
  if (selectedTool.id === 'compare') {
    list.innerHTML = comparisonFiles.map((file, index) => `<div class="file-entry"><span>${index + 1}. ${index === 0 ? '基准版本' : '对比版本'}：${escape(file?.name || '未上传')}</span><button type="button" data-clear-version="${index}" ${file ? '' : 'disabled'}>移除</button></div>`).join('')
    list.querySelectorAll('[data-clear-version]').forEach(node => node.onclick = () => {
      comparisonFiles[Number(node.dataset.clearVersion)] = null
      selectedFiles = comparisonFiles.filter(Boolean)
      updateComparisonNames()
      updateFileList()
    })
    return
  }
  list.innerHTML = selectedFiles.map((file, index) => `<div class="file-entry"><span>${index + 1}. ${escape(file.name)} <small class="muted">${(file.size / 1024).toFixed(1)} KB</small></span><div><button type="button" data-up="${index}" aria-label="上移 ${escape(file.name)}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-down="${index}" aria-label="下移 ${escape(file.name)}" ${index === selectedFiles.length - 1 ? 'disabled' : ''}>↓</button><button type="button" data-remove="${index}" aria-label="移除 ${escape(file.name)}">移除</button></div></div>`).join('')
  list.querySelectorAll('[data-up]').forEach(node => node.onclick = () => moveFile(Number(node.dataset.up), -1))
  list.querySelectorAll('[data-down]').forEach(node => node.onclick = () => moveFile(Number(node.dataset.down), 1))
  list.querySelectorAll('[data-remove]').forEach(node => node.onclick = () => {
    selectedFiles.splice(Number(node.dataset.remove), 1)
    updateFileList()
  })
}
function review() {
  if (selectedTool.id === 'compare' && comparisonFiles.some(file => !file)) return toast('请分别上传基准版本和对比版本')
  if (selectedTool.id === 'summary' && !options.focus?.trim()) return toast('请至少选择一个关注内容')
  if (selectedTool.id === 'compare' && selectedFiles.length !== 2) return toast('对比请选择两份文件：原始版本在前，新版本在后')
  if (selectedTool.id === 'summary' && selectedFiles.length > 10) return toast('摘要最多选择 10 份文件')
  if (!selectedFiles.length || selectedFiles.length > 30 || selectedFiles.reduce((sum, file) => sum + file.size, 0) > 32 * 1024 * 1024) return toast('请选择 1–30 个文件，总大小不超过 32 MB')
  main.innerHTML = `<div class="doc-flow"><h1>核对任务信息</h1><p class="muted">请仔细核对以下任务信息，确认无误后开始处理。</p><div class="stepbar"><span>1 准备材料</span><span class="current">2 核对信息</span><span>3 处理与交付</span></div><section class="panel"><h2>任务信息确认</h2><dl class="doc-details"><dt>任务类型</dt><dd>${escape(selectedTool.name)}</dd><dt>任务名称</dt><dd>${escape(options.taskName || selectedTool.name)}</dd><dt>${selectedTool.id === 'compare' ? '基准／对比版本' : '已上传文件'}</dt><dd>${selectedFiles.map((file, index) => `${index + 1}. ${escape(file.name)}`).join('<br>')}</dd><dt>文件数量</dt><dd>${selectedFiles.length}</dd>${selectedTool.params.map(([key, label]) => `<dt>${escape(label)}</dt><dd>${escape(options[key] || '未填写')}</dd>`).join('')}</dl></section><div class="doc-review-warning">重要结论、数字和责任主体请结合原始文档核对。对比仅覆盖可提取文字，不比较版式和图片。</div><div class="actions"><button class="secondary" id="return">返回修改</button><button class="primary" id="start">开始处理</button></div></div>`
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
  } catch (error) { main.innerHTML = `<section class="panel"><h1>无法打开工作台</h1><p class="error">${escape(error.message)}</p><p class="muted">请关闭当前 Tab，从桌面专家库重新打开。</p></section>` }
}
window.addEventListener('pagehide', () => clearInterval(timer))
boot()
