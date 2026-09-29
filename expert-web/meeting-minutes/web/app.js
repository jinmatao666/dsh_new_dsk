const tools = [
 { id: 'minutes', name: '生成会议纪要', description: '添加最多一份录音，也可只用已有转写稿和文字材料，生成会议信息、核心结论、决策与待办事项。', accept: '.wav,.mp3,.m4a,.docx,.pdf,.xlsx,.xlsm,.txt,.md,.csv,.tsv,.json,.yaml,.yml', multiple: true,
   params: [['title', '会议名称（可留空）', null, '']] },
]
const main = document.querySelector('#main')
let currentPage = 'home', selectedTool, selectedFiles = [], options = {}, tasks = [], timer, toastTimer, busy = false
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
let sessionExpired = false
let waitingTimer
function waitingElapsed(created, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - Number(created) * 1000) / 1000))
  if (!Number.isFinite(seconds)) return '正在等待处理'
  const minutes = Math.floor(seconds / 60)
  return `已等待 ${minutes ? `${minutes} 分 ` : ''}${seconds % 60} 秒`
}
function syncWaitingClock() {
  clearInterval(waitingTimer)
  const nodes = main.querySelectorAll('[data-meeting-created]')
  if (!nodes.length) return
  const update = () => nodes.forEach(node => { node.textContent = waitingElapsed(node.dataset.meetingCreated) })
  update()
  waitingTimer = setInterval(update, 1000)
}
function showExpiredSession() {
  clearInterval(waitingTimer)
  main.innerHTML = '<section class="panel"><h1>登录已失效</h1><p>请关闭当前 Tab，从桌面专家库重新打开。</p></section>'
}
function expireSession() {
  sessionExpired = true
  clearInterval(timer)
  tasks = []; selectedFiles = []; options = {}
  executionSummaries.clear()
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
let selectedTask, historyQuery = '', historyFilter = 'all'
const executionSummaries = new Map()
const stateLabels = { queued: '等待处理', running: '正在处理', succeeded: '已完成', failed: '处理失败', cancelled: '已取消' }
function toolIcon(id) {
  return '/assets/audio.png'
}
function historyMarkup() {
  const filtered = tasks.filter(task => {
    const name = task.options.taskName || task.options.title || tools.find(tool => tool.id === task.tool)?.name || task.tool
    const status = ['queued', 'running'].includes(task.state) ? 'running' : task.state === 'succeeded' ? 'completed' : 'failed'
    return name.toLocaleLowerCase().includes(historyQuery.toLocaleLowerCase()) && (historyFilter === 'all' || historyFilter === status)
  })
  return filtered.length ? `<div class="record-table"><div class="record-head"><span>会议名称</span><span>创建时间</span><span>处理状态</span><span>操作</span></div>${filtered.map(task => `<button class="record-row" data-task="${escape(task.id)}"><span class="record-name"><img src="${toolIcon(task.tool)}" alt=""><strong>${escape(task.options.taskName || task.options.title || tools.find(tool => tool.id === task.tool)?.name || task.tool)}</strong></span><span>${escape(new Date(task.created * 1000).toLocaleString())}</span><em class="${escape(task.state)}">${escape(stateLabels[task.state] || task.state)}</em><span class="record-open">查看详情 →</span></button>`).join('')}</div>` : `<div class="record-empty"><svg class="ui-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/></svg><h2>${historyQuery || historyFilter !== 'all' ? '没有找到符合条件的记录' : '暂无会议纪要记录'}</h2><p>${historyQuery || historyFilter !== 'all' ? '试试调整搜索词或筛选条件。' : '创建第一份会议纪要，处理进度和结果会显示在这里。'}</p><button class="primary" data-tool="minutes">＋ 新建纪要</button></div>`
}
function historyToolbar() {
  return `<div class="history-toolbar"><input id="history-search" aria-label="搜索会议" value="${escape(historyQuery)}" placeholder="搜索会议名称"><div>${[['all','全部'],['running','处理中'],['completed','已完成'],['failed','未完成']].map(([value,label]) => `<button data-history-filter="${value}" aria-pressed="${historyFilter === value}">${label}</button>`).join('')}</div></div>`
}
function filesMarkup() {
  const files = tasks.filter(task => task.state === 'succeeded').flatMap(task => task.outputs.map((name, index) => ({ task, name, index })))
  return files.length ? `<div class="outputs">${files.map(({ task, name, index }) => `<div><span><strong>${escape(name)}</strong><small>${escape(task.options.taskName || task.options.title || tools.find(tool => tool.id === task.tool)?.name || task.tool)}</small></span><a class="primary" href="/api/tasks/${escape(task.id)}/files/${index}" download>下载文件</a></div>`).join('')}</div>` : '<p class="empty">暂无成果文件，任务完成后可在这里下载。</p>'
}
function taskMarkup() {
  const task = tasks.find(item => item.id === selectedTask)
  if (!task) return '<h1>任务暂不可用</h1><p class="muted">记录可能已超过保留期限，请返回任务记录查看。</p>'
  const title = escape(task.options.taskName || task.options.title || '会议纪要')
  const inputs = task.input_names?.length ? task.input_names : task.inputs
  const active = ['queued', 'running'].includes(task.state)
  const completed = task.state === 'succeeded'
  const heading = completed ? '会议纪要已生成' : task.state === 'cancelled' ? '会议纪要已取消' : active ? '正在处理会议材料' : '本次纪要未完成'
  const detail = completed ? '任务正常结束，可下载本次生成的 Word 文件。' : active ? '任务已提交，可以切换到记录页，处理会继续进行。' : task.error || '这次任务没有生成成果，请检查材料后重试。'
  const waiting = `<section class="meeting-waiting meeting-waiting-active" aria-busy="true"><span class="meeting-wave" aria-hidden="true">${'<i></i>'.repeat(7)}</span><h3>${task.state === 'queued' ? '等待开始处理' : '正在生成纪要'}</h3><p>${task.state === 'queued' ? '任务已进入队列，开始处理后页面会自动更新。' : '正在处理会议材料，请稍候。'}</p><strong class="meeting-elapsed" data-meeting-created="${escape(task.created)}">${waitingElapsed(task.created)}</strong><p class="meeting-waiting-note">录音较长或材料较多时，处理可能需要几分钟。<br>你可以切换到其他页面，稍后在纪要记录中查看结果。</p><small>当前服务不提供逐步骤进度，完成后页面会自动更新。</small></section>`
  const files = completed ? task.outputs.map((name, index) => `<section class="meeting-deliverable"><svg class="ui-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/></svg><div><strong>${escape(name)}</strong><small>本次任务正式成果文件</small></div><a class="primary" href="/api/tasks/${escape(task.id)}/files/${index}" download>下载成果文件</a></section>`).join('') : ''
  return `<div class="meeting-flow"><header class="meeting-task-heading"><span>会议纪要任务</span><h1>${title}</h1><p>创建于 ${escape(new Date(task.created * 1000).toLocaleString())}</p></header><section class="meeting-status" data-status="${escape(task.state)}"><span aria-hidden="true">${completed ? '✓' : active ? '◷' : '!'}</span><div><h3>${heading}</h3><p>${escape(detail)}</p></div></section><div class="meeting-result-grid"><div>${active ? waiting : summaryMarkup(task) || '<section class="meeting-waiting"><h3>没有可展示的执行摘要</h3><p>请根据任务状态检查材料。</p></section>'}${files}</div><aside class="meeting-task-info"><h3>本次来源</h3>${inputs.map(name => `<p><img src="${/\.(wav|m4a|mp3)$/i.test(name) ? '/assets/audio.png' : '/assets/material.png'}" alt=""><span title="${escape(name)}">${escape(name)}</span></p>`).join('')}<small>成果文件由本专家服务保存，可从结果页下载。</small><button class="secondary" data-page="history">查看我的纪要记录</button>${active ? `<button class="secondary" data-cancel="${escape(task.id)}">取消任务</button>` : completed ? '' : '<button class="secondary" data-tool="minutes">修改材料后重新创建</button>'}</aside></div></div>`
}
function meetingStepBar(stage) {
  return `<div class="meeting-stepbar">${[['准备材料','上传文件'],['核对信息','确认任务'],['系统处理','生成纪要'],['获取结果','下载成果']].map(([name, detail], index) => `<div class="${index + 1 < stage ? 'done' : index + 1 === stage ? 'current' : ''}"><span>${index + 1 < stage ? '✓' : index + 1}</span><strong>${name}</strong><small>${detail}</small></div>`).join('')}</div>`
}
function meetingRichText(text) {
  const lines = text.split(/\r?\n/)
  const nodes = []
  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim()
    if (line.includes('|') && /^\|?\s*:?-+/.test((lines[index + 1] || '').trim())) {
      const headers = line.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
      const rows = []
      index += 2
      while (index < lines.length && lines[index].includes('|')) {
        rows.push(lines[index].replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()))
        index += 1
      }
      nodes.push(`<div class="meeting-answer-table"><table><thead><tr>${headers.map(cell => `<th>${escape(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map((_, cell) => `<td>${escape(row[cell] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)
      continue
    }
    const content = line.replace(/\*\*/g, '')
    if (/^#{1,3}\s/.test(content)) nodes.push(`<h4>${escape(content.replace(/^#{1,3}\s/, ''))}</h4>`)
    else if (/^(?:[-•*]|\d+\.)\s/.test(content)) nodes.push(`<p class="meeting-answer-point">${escape(content.replace(/^(?:[-•*]|\d+\.)\s/, ''))}</p>`)
    else nodes.push(content ? `<p>${escape(content)}</p>` : '<br>')
    index += 1
  }
  return `<div class="meeting-answer">${nodes.join('')}</div>`
}
function summaryMarkup(task) {
  if (task.state !== 'succeeded') return ''
  const value = executionSummaries.get(task.id)
  if (value === undefined) return '<section class="panel execution-summary"><h2>执行摘要</h2><p class="muted">正在读取本次任务的纪要正文…</p></section>'
  if (value === null) return '<section class="panel execution-summary"><h2>执行摘要</h2><p class="error">摘要暂不可读，请下载本次任务生成的 Word 纪要核对。</p></section>'
  return `<section class="panel execution-summary"><h2>执行摘要</h2>${meetingRichText(value.text)}${value.truncated ? '<p class="muted">这里只预览部分正文，完整内容请下载 Word 纪要。</p>' : ''}</section>`
}
async function loadSummary(task) {
  if (task?.state !== 'succeeded' || executionSummaries.has(task.id)) return
  executionSummaries.set(task.id, undefined)
  try {
    const response = await authenticatedFetch(`/api/tasks/${encodeURIComponent(task.id)}/summary`)
    if (!response.ok) throw new Error('summary unavailable')
    const raw = await response.text()
    if (sessionExpired) return
    if (raw.length > 100000) throw new Error('summary too large')
    const value = JSON.parse(raw)
    if (typeof value.text !== 'string' || typeof value.truncated !== 'boolean') throw new Error('invalid summary')
    executionSummaries.set(task.id, value)
  } catch { if (!sessionExpired) executionSummaries.set(task.id, null) }
  if (currentPage === 'result' && selectedTask === task.id) render()
}
function homeMarkup() {
  const recent = tasks.slice(0, 3)
  const recentRows = recent.length
    ? `<div class="history-list">${recent.map(task => `<button class="history-row" data-task="${escape(task.id)}"><img src="${toolIcon(task.tool)}" alt=""><span><strong>${escape(task.options.taskName || task.options.title || '会议纪要')}</strong><small>${escape(new Date(task.created * 1000).toLocaleString())} · ${task.inputs.length} 个来源</small></span><em class="${escape(task.state)}">${escape(stateLabels[task.state] || task.state)}</em></button>`).join('')}</div>`
    : '<div class="home-empty"><svg class="ui-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/></svg><strong>暂无纪要记录</strong><p>还没有创建任何会议纪要，点击「新建纪要」开始体验吧！</p><button class="primary" data-tool="minutes">＋ 新建纪要</button></div>'
  return `<div class="meeting-dashboard"><section class="meeting-hero"><span class="hero-kicker">会议纪要专家</span><h1>专注会议内容，生成专业纪要</h1><p>基于您提供的会议材料，智能梳理会议要点、讨论内容和行动事项，生成结构清晰、内容准确的 Word 会议纪要，帮助团队高效沉淀会议成果。</p><div class="hero-actions"><button class="primary" data-tool="minutes">＋ 新建纪要 →</button><button class="secondary" data-page="guide">查看使用说明</button></div></section><aside class="meeting-abilities"><h2>能力说明</h2><div><strong>支持多种会议材料格式</strong><p>最多一个 WAV、M4A、MP3 录音，以及 DOCX、PDF、Excel 和文字材料；也可仅用文字材料。</p></div><div><strong>智能理解会议内容</strong><p>整理会议主题、重要讨论、决策结论与行动事项。</p></div><div><strong>生成专业会议纪要</strong><p>输出一个结构清晰、可复核的 Word 会议纪要文件。</p></div><div><strong>适用于多种会议场景</strong><p>工作例会、项目评审、专题研讨与沟通协同。</p></div></aside><section class="meeting-steps"><h2>4 步完成会议纪要生成</h2><p>上传会议材料，简单几步即可获得专业的会议纪要文件。</p><div>${[['01','准备材料','上传会议音频和／或相关会议材料'],['02','核对信息','确认会议名称与处理要求'],['03','系统处理','AI 智能分析会议内容并整理结构'],['04','获取结果','生成并下载 Word 会议纪要']].map(([number,title,detail]) => `<article><span>${number}</span><strong>${title}</strong><small>${detail}</small></article>`).join('')}</div></section><section class="meeting-recent"><div class="section-heading"><div><h2>最近的纪要记录</h2><p>展示您在本专家的历史任务记录。</p></div><button class="text-action" data-page="history">查看全部 →</button></div>${recentRows}</section><aside class="meeting-tips"><h2>使用提示</h2><ul><li>需提供至少一份可阅读的会议材料（录音或伴随文字资料）。</li><li>音频文件支持 WAV、M4A、MP3，最多上传 1 个。</li><li>扫描 PDF 请先 OCR；不支持图片、PPT 或旧版 Word/Excel。</li><li>系统只生成 1 个 Word 会议纪要文件作为正式结果。</li></ul></aside></div>`
}
function updateNavigation() {
  const page = currentPage === 'form' ? 'home' : currentPage === 'result' ? 'history' : currentPage
  document.querySelectorAll('aside [data-page]').forEach(node => node.classList.toggle('active', node.dataset.page === page))
}
function render() {
  if (sessionExpired) { showExpiredSession(); return }
  updateNavigation()
  if (currentPage === 'home') main.innerHTML = homeMarkup()
  if (currentPage === 'history' || currentPage === 'files') main.innerHTML = `<div class="meeting-flow"><div class="page-heading"><div><span class="eyebrow">会议纪要专家</span><h1>${currentPage === 'history' ? '我的纪要记录' : '我的成果文件'}</h1><p>仅展示当前用户在本专家服务中的${currentPage === 'history' ? '任务与进度' : '已生成成果'}。</p></div><button class="primary" data-tool="minutes">＋ 新建纪要</button></div>${currentPage === 'history' ? historyToolbar() + historyMarkup() : filesMarkup()}</div>`
  if (currentPage === 'result') { main.innerHTML = taskMarkup(); void loadSummary(tasks.find(task => task.id === selectedTask)) }
  if (currentPage === 'guide') main.innerHTML = `<div class="meeting-flow guide-page"><button class="text-action" data-page="home">← 返回首页</button><section class="guide-hero"><span class="eyebrow">使用指南</span><h1>让每场会议，都有清晰的记录</h1><p>准备录音或文字材料，核对提交信息，获得可复核的 Word 会议纪要。</p><button class="primary" data-tool="minutes">＋ 新建纪要</button></section><div class="guide-grid"><section class="panel"><span>01 / 材料准备</span><h2>上传会议内容</h2><p>支持一个 WAV、MP3、M4A 录音和多份 DOCX、PDF、Excel 或文字材料；也可仅使用文字。最多 30 个文件，总大小不超过 100 MB，录音不超过 60 分钟。</p></section><section class="panel"><span>02 / 提交确认</span><h2>核对文件与名称</h2><p>提交前检查所选材料和会议名称。扫描 PDF 请先 OCR；图片、PPT 和旧版 Word/Excel 暂不支持。</p></section><section class="panel"><span>03 / 系统处理</span><h2>等待完整结果</h2><p>录音会先转写，再与其他材料一起整理。任何转写段失败时，不会发布不完整的成果。</p></section><section class="panel"><span>04 / 结果复核</span><h2>下载并检查纪要</h2><p>仅最终 Word 文件作为成果。会议时间、地点、人员、决策、数字和责任主体都应回到原始材料核对。</p></section></div></div>`
  bind()
  syncWaitingClock()
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
  const search = document.querySelector('#history-search')
  if (search) search.oninput = () => { historyQuery = search.value; const position = search.selectionStart; render(); const next = document.querySelector('#history-search'); next?.focus(); if (position !== null) next?.setSelectionRange(position, position) }
  main.querySelectorAll('[data-history-filter]').forEach(node => node.onclick = () => { historyFilter = node.dataset.historyFilter; render() })
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
function form(tool, preserve = false) {
  clearInterval(waitingTimer)
  if (sessionExpired) { showExpiredSession(); return }
  selectedTool = tool
  if (!preserve) {
    selectedFiles = []
    options = Object.fromEntries(tool.params.map(([key,,, value]) => [key, value]))
  }
  currentPage = 'form'
  updateNavigation()
  main.innerHTML = `<div class="meeting-flow"><button class="text-action" id="back">← 返回首页</button><div class="page-heading"><div><span class="eyebrow">创建会议纪要</span><h1>准备会议材料</h1><p>上传录音或文字材料，开始生成专业会议纪要。</p></div></div>${meetingStepBar(1)}<div class="formgrid meeting-formgrid"><section class="panel meeting-inputs"><h2>会议信息</h2><label>任务名称 <small>可选</small><input id="task-name" maxlength="180" value="${escape(options.taskName || '')}" placeholder="例如：项目周例会"></label><label>会议名称 <small>可选</small><input data-param="title" value="${escape(options.title || '')}" placeholder="留空则根据材料整理"></label><h2>上传会议材料</h2><div class="meeting-source-grid"><button type="button" id="audio-pick"><img src="/assets/audio.png" alt=""><strong>上传会议录音</strong><small>点击选择 WAV、M4A、MP3，最多一份</small></button><button type="button" id="append-files"><img src="/assets/material.png" alt=""><strong>上传会议资料</strong><small>点击选择文字、Word、PDF 或表格</small></button></div><div id="dropzone" class="dropzone"><p class="drop-hint">也可将文件拖放至此处</p></div><input id="audio-upload" type="file" hidden accept=".wav,.mp3,.m4a"><input type="file" id="append-upload" hidden accept=".docx,.pdf,.xlsx,.xlsm,.txt,.md,.csv,.tsv,.json,.yaml,.yml" multiple><div id="filelist" class="filelist"></div></section><aside class="meeting-form-aside"><section class="panel"><h2>材料要求</h2><ul><li>至少上传一份可读取的录音或文字材料。</li><li>最多 1 份录音、30 个文件，总大小不超过 100 MB。</li><li>扫描 PDF 需要先进行 OCR。</li></ul></section><section class="panel"><h2>处理说明</h2><p>系统会结合您提供的材料生成一份 Word 纪要。提交前请检查文件和会议名称。</p></section></aside></div><div class="actions"><button class="secondary" data-page="home">取消</button><button class="primary" id="review">下一步：核对信息</button></div></div>`
  document.querySelectorAll('[data-param]').forEach(node => { node.value = options[node.dataset.param] ?? '' })
  updateFileList()
  document.querySelector('#task-name').oninput = event => { options.taskName = event.target.value }
  document.querySelector('#append-files').onclick = () => document.querySelector('#append-upload').click()
  document.querySelector('#append-upload').onchange = event => { selectFiles(event.target.files, true); event.target.value = '' }
  document.querySelector('#audio-pick').onclick = () => document.querySelector('#audio-upload').click()
  document.querySelector('#audio-upload').onchange = event => {
    const audio = Array.from(event.target.files || []).slice(0, 1)
    if (audio.length) selectFiles([...selectedFiles.filter(file => !/\.(wav|mp3|m4a)$/i.test(file.name)), ...audio])
    event.target.value = ''
  }
  const dropzone = document.querySelector('#dropzone')
  dropzone.ondragover = event => { event.preventDefault(); dropzone.classList.add('dragging') }
  dropzone.ondragleave = event => { if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('dragging') }
  dropzone.ondrop = event => {
    event.preventDefault(); dropzone.classList.remove('dragging')
    const dropped = Array.from(event.dataTransfer.files || [])
    const audioCount = dropped.filter(file => /\.(wav|mp3|m4a)$/i.test(file.name)).length
    if (audioCount === 1) selectFiles([...selectedFiles.filter(file => !/\.(wav|mp3|m4a)$/i.test(file.name)), ...dropped])
    else selectFiles(dropped, true)
  }
  document.querySelectorAll('[data-param]').forEach(node => node.onchange = () => { options[node.dataset.param] = node.value })
  document.querySelector('#back').onclick = () => { currentPage = 'home'; render() }
  document.querySelector('[data-page="home"]').onclick = () => { currentPage = 'home'; render() }
  document.querySelector('#review').onclick = review
}
function selectFiles(incoming, append = false) {
  const added = Array.from(incoming)
  if (!added.length) return false
  const candidate = append && selectedTool.multiple ? [...selectedFiles, ...added] : added
  if (!selectedTool.multiple && candidate.length !== 1) { toast('这个工具一次只能选择一个文件'); return false }
  if (candidate.filter(file => /\.(wav|mp3|m4a)$/i.test(file.name)).length > 1) { toast('一次任务最多选择一个录音'); return false }
  if (candidate.length > 30 || candidate.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) { toast('最多 30 个文件，总大小不超过 100 MB'); return false }
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
  if (selectedFiles.filter(file => /\.(wav|mp3|m4a)$/i.test(file.name)).length > 1) return toast('一次任务最多选择一个录音')
  if (selectedTool.id === 'summary' && selectedFiles.length > 10) return toast('摘要最多选择 10 份文件')
  if (!selectedFiles.length || selectedFiles.length > 30 || selectedFiles.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) return toast('请选择 1–30 个文件，总大小不超过 100 MB')
  main.innerHTML = `<div class="meeting-flow"><button class="text-action" id="return">← 返回修改材料</button><div class="page-heading"><div><span class="eyebrow">创建会议纪要</span><h1>核对会议信息</h1><p>请确认以下内容，提交后系统将开始处理。</p></div></div>${meetingStepBar(2)}<section class="panel review-panel"><div class="review-title"><img src="/assets/material.png" alt=""><div><h2>任务信息确认</h2><p>请检查会议名称和已上传的文件</p></div></div><dl class="result-details"><dt>任务名称</dt><dd>${escape(options.taskName || selectedTool.name)}</dd><dt>会议名称</dt><dd>${escape(options.title || '未填写，将根据材料整理')}</dd><dt>会议录音</dt><dd>${selectedFiles.filter(file => /\.(wav|mp3|m4a)$/i.test(file.name)).map(file => escape(file.name)).join('<br>') || '未上传'}</dd><dt>会议资料</dt><dd>${selectedFiles.filter(file => !/\.(wav|mp3|m4a)$/i.test(file.name)).map(file => escape(file.name)).join('<br>') || '未上传'}</dd><dt>预期成果</dt><dd>Word 会议纪要</dd></dl></section><div class="review-note">请确认材料可读取。扫描 PDF 请先 OCR；生成结果仍需结合原始材料人工复核。</div><div class="actions"><button class="secondary" id="return-bottom">返回修改</button><button class="primary" id="start">确认并开始生成</button></div></div>`
  document.querySelector('#return').onclick = () => form(selectedTool, true)
  document.querySelector('#return-bottom').onclick = () => form(selectedTool, true)
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
window.addEventListener('pagehide', () => { clearInterval(timer); clearInterval(waitingTimer) })
boot()
