const tools = [
  { id: 'word-pdf', name: 'Word 转 PDF', description: '批量将 DOC、DOCX 或 DOCM 转为 PDF，使用服务端 LibreOffice 转换器。', accept: '.doc,.docx,.docm', multiple: true, params: [] },
  { id: 'pdf-images', name: 'PDF 转图片', description: '将一个 PDF 的全部页面或指定页码导出为 PNG 或 JPG。', accept: '.pdf', multiple: false,
    params: [['format', '输出格式', ['png', 'jpg'], 'png'], ['pages', '页码范围（留空表示全部）', null, ''], ['dpi', 'DPI', ['144', '200', '300'], '144']] },
  { id: 'pdf-organize', name: 'PDF 合并拆分', description: '合并多个 PDF，或按合法页码范围拆分一个 PDF。', accept: '.pdf', multiple: true,
    params: [['mode', '处理模式', [['merge', '合并'], ['ranges', '按范围拆分'], ['pages', '逐页拆分']], 'merge'], ['pages', '拆分页码范围', null, '']] },
  { id: 'images-pdf', name: '图片转 PDF', description: '按选择顺序将图片生成一个 PDF，保持比例且不裁切。', accept: '.jpg,.jpeg,.png,.webp', multiple: true,
    params: [['pageSize', '页面尺寸', [['original', '原始尺寸'], 'A4', 'A3', 'Letter'], 'A4'], ['orientation', '方向', [['auto', '自动'], ['portrait', '纵向'], ['landscape', '横向']], 'auto'], ['margin', '页边距（mm）', null, '10']] },
  { id: 'image-optimize', name: '图片压缩与格式转换', description: '批量优化 JPG、PNG、WebP；保持比例、不放大。', accept: '.jpg,.jpeg,.png,.webp', multiple: true,
    params: [['format', '输出格式', [['original', '保持原格式'], 'jpg', 'png', 'webp'], 'webp'], ['quality', '质量（PNG 不使用有损质量）', null, '85'], ['maxWidth', '最大宽度', null, '1920'], ['maxHeight', '最大高度', null, '1080']] },
]
const main = document.querySelector('#main')
let currentPage = 'home', selectedTool, selectedFiles = [], options = {}, tasks = [], timer, toastTimer, busy = false
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
function parameterText(tool, key, values, raw) {
  if (raw === undefined || raw === null || raw === '') {
    if (key === 'pages') return tool.id === 'pdf-images' ? '全部页面' : '不适用'
    return '未填写'
  }
  const entry = values?.find(value => String(Array.isArray(value) ? value[0] : value) === String(raw))
  return Array.isArray(entry) ? entry[1] : String(raw)
}
function expectedOutputs(tool, values, count) {
  switch (tool.id) {
    case 'word-pdf': return `${count} 个 PDF 文件（每份 Word 对应一个）`
    case 'pdf-images': return `${values.format === 'jpg' ? 'JPG' : 'PNG'} 图片（按所选页码逐页生成）`
    case 'pdf-organize': return values.mode === 'merge' ? '1 个合并后的 PDF 文件' : '拆分后的 PDF 文件'
    case 'images-pdf': return '1 个 PDF 文件'
    case 'image-optimize': return `${count} 张${values.format === 'original' ? '优化后的图片' : ` ${String(values.format).toUpperCase()} 图片`}`
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
  imagePreviews.clear()
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
function taskCards(items) {
  const states = { queued: '等待处理', running: '正在处理', succeeded: '已完成', failed: '处理失败', cancelled: '已取消' }
  return items.length ? items.map(task => `<article class="task"><h3>${escape(tools.find(tool => tool.id === task.tool)?.name || task.tool)}</h3><small class="muted">${escape(new Date(task.created * 1000).toLocaleString())}</small><p class="${escape(task.state)}">${escape(states[task.state] || task.state)}</p>${task.error ? `<p class="error">${escape(task.error)}</p>` : ''}${task.state === 'succeeded' ? task.outputs.map((name, index) => `<a href="api/tasks/${task.id}/files/${index}" download>${escape(name)}</a>`).join('') : ''}${['queued', 'running'].includes(task.state) ? `<button class="secondary" data-cancel="${task.id}">取消任务</button>` : ''}</article>`).join('') : '<p class="empty">暂无任务，选择一个工具开始处理。</p>'
}
let selectedTask
const stateLabels = { queued: '等待处理', running: '正在处理', succeeded: '已完成', failed: '处理失败', cancelled: '已取消' }
function emptyMarkup(kind) {
  const records = kind === 'history'
  return `<div class="conversion-empty"><img src="assets/${records ? 'history' : 'files'}.png" alt=""><strong>${records ? '暂无处理记录' : '暂无成果文件'}</strong><p>${records ? '新建任务后，处理状态和结果会显示在这里。' : '处理完成后，可在这里下载当前用户的实际成果。'}</p><button class="primary" data-tool="word-pdf">新建处理</button></div>`
}
function toolIcon(id) {
  return `assets/${['word-pdf', 'pdf-images', 'pdf-organize', 'images-pdf', 'image-optimize'].includes(id) ? id : 'history'}.png`
}
function historyMarkup() {
  return tasks.length ? `<div class="history-list">${tasks.map(task => `<button class="history-row" data-task="${escape(task.id)}"><img src="${toolIcon(task.tool)}" alt=""><span><strong>${escape(task.options.taskName || task.options.title || tools.find(tool => tool.id === task.tool)?.name || task.tool)}</strong><small>${escape(new Date(task.created * 1000).toLocaleString())} · ${task.inputs.length} 个文件 · ${escape(tools.find(tool => tool.id === task.tool)?.name || task.tool)}</small></span><em class="${escape(task.state)}">${escape(stateLabels[task.state] || task.state)}</em></button>`).join('')}</div>` : emptyMarkup('history')
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
  const outputFiles = `<h3>真实成果文件</h3><div class="conversion-result-files">${success && task.outputs.length ? task.outputs.map((name, index) => `<div><span>${escape(name)}</span><a class="primary" href="api/tasks/${escape(task.id)}/files/${index}" download>下载文件</a></div>`).join('') : '<p class="muted">尚未找到符合本任务要求的成果文件。</p>'}</div>`
  const details = `<dl class="conversion-details"><dt>任务名称</dt><dd>${escape(task.options.taskName || task.options.title || tool?.name || task.tool)}</dd><dt>所选工具</dt><dd>${escape(tool?.name || task.tool)}</dd><dt>创建时间</dt><dd>${escape(new Date(task.created * 1000).toLocaleString())}</dd><dt>输入文件</dt><dd>${(task.input_names?.length ? task.input_names : task.inputs).map(name => escape(name)).join('<br>')}</dd>${(tool?.params || []).map(([key, label, values]) => { return `<dt>${escape(label)}</dt><dd>${escape(parameterText(tool, key, values, task.options[key]))}</dd>` }).join('')}</dl>`
  return `<div class="conversion-flow"><button class="text-action" data-page="history">← 返回处理记录</button>${taskHeader}<section class="conversion-result ${escape(task.state)}"><header class="conversion-result-head"><div><small>真实任务状态</small><h3>${escape(stateLabels[task.state] || task.state)}</h3></div></header>${task.error ? `<p class="error conversion-result-error">${escape(task.error)}</p>` : ''}${outputFiles}</section><details class="conversion-task-details"><summary>任务详情</summary>${details}</details><div class="actions">${active ? `<button class="secondary" data-cancel="${escape(task.id)}">取消任务</button>` : !success && tool ? `<button class="primary" data-tool="${escape(tool.id)}">重新创建处理</button>` : ''}<button class="secondary" data-page="history">查看处理记录</button></div></div>`
}
function homeMarkup() {
  const facts = [['原文件不覆盖', '成果另行保存'], ['操作简单', '选择工具并确认参数'], ['多种格式', '覆盖常见文档与图片']]
  const formatLabels = {
    'word-pdf': '.doc　.docx　.docm', 'pdf-images': '.pdf → .png / .jpg',
    'pdf-organize': '.pdf', 'images-pdf': '.jpg　.png　.webp',
    'image-optimize': '.jpg　.png　.webp',
  }
  const recent = tasks.slice(0, 3)
  const recentRows = recent.length
    ? `<div class="history-list">${recent.map(task => `<button class="history-row" data-task="${escape(task.id)}"><img src="${toolIcon(task.tool)}" alt=""><span><strong>${escape(task.options.taskName || task.options.title || tools.find(tool => tool.id === task.tool)?.name || task.tool)}</strong><small>${escape(new Date(task.created * 1000).toLocaleString())} · ${task.inputs.length} 个文件</small></span><em class="${escape(task.state)}">${escape(stateLabels[task.state] || task.state)}</em></button>`).join('')}</div>`
    : '<div class="conversion-empty"><svg class="ui-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/></svg><strong>还没有处理记录</strong><p>从上方选择适合的工具，开始处理文件。</p></div>'
  return `<div class="conversion-dashboard"><section class="conversion-hero"><h1>选择一个工具，开始处理文件</h1><p>转换文档与图片格式、整理 PDF 页面或优化图片。文件由专家服务处理，原始文件不会被覆盖；请核对下载后的成果。</p><div>${facts.map(([name,detail]) => `<span><strong>${name}</strong><small>${detail}</small></span>`).join('')}</div></section><section class="conversion-tools">${tools.map(tool => `<article class="conversion-tool"><img src="${toolIcon(tool.id)}" alt=""><h2>${escape(tool.name)}</h2><p>${escape(tool.description)}</p><div><small>支持格式</small><strong>${formatLabels[tool.id]}</strong></div><button class="primary" data-tool="${tool.id}">${tool.id === 'pdf-organize' || tool.id === 'image-optimize' ? '开始处理' : '开始转换'}</button></article>`).join('')}</section><section class="conversion-recent"><div><h2>最近处理</h2><button class="text-action" data-page="history">查看全部</button></div>${recentRows}</section></div>`
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
  if (currentPage === 'guide') main.innerHTML = '<div class="guide-page"><button class="text-action" data-page="home">← 返回首页</button><section class="guide-hero"><span class="eyebrow">使用指南</span><h1>把文件转换成需要的格式</h1><p>准备材料，核对提交信息，查看处理结果并下载成果。</p><button class="primary" data-tool="word-pdf">＋ 新建任务</button></section><div class="guide-grid"><section class="panel"><span>01 / 文件与处理范围</span><h2>文件与处理范围</h2><p>PDF 不超过 300 页；暂不支持加密 PDF。页码可填写 1-3,5，范围不能重叠。图片不超过 2400 万像素。</p></section><section class="panel"><span>02 / 提交前核对</span><h2>提交前核对</h2><p>核对所选文件、任务名称和处理选项，再确认提交。任务进度、记录与成果均可在当前专家工作台查看。</p></section><section class="panel"><span>03 / 任务与成果</span><h2>任务与成果</h2><p>关闭网页后任务仍由专家服务处理。重新打开工作台可查看记录。取消会终止本地转换进程且不会发布成果。处理失败请检查文件，重新提交。</p></section><section class="panel"><span>04 / Word 转 PDF</span><h2>Word 转 PDF</h2><p>由服务端 LibreOffice 转换，不调用本机 Word/WPS。字体和复杂排版可能与本机不同，使用前请核对成果。不支持加密文档，不执行文档宏。</p></section></div></div>'
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
function form(tool, preserve = false) {
  if (sessionExpired) { showExpiredSession(); return }
  selectedTool = tool
  if (!preserve) {
    selectedFiles = []
    options = Object.fromEntries(tool.params.map(([key,,, value]) => [key, value]))
  }
  currentPage = 'form'
  updateNavigation()
  main.innerHTML = `<h1>${escape(tool.name)}</h1><p class="muted">${escape(tool.description)}</p><div class="stepbar"><span class="current">1 准备文件</span><span>2 确认任务</span><span>3 处理与结果</span></div><div class="formgrid"><section class="panel"><label>任务名称<input id="task-name" maxlength="180" value="${escape(options.taskName || '')}" placeholder="留空则按工具名称展示"></label><input id="upload" type="file" hidden accept="${tool.accept}" ${tool.multiple ? 'multiple' : ''}><button type="button" id="dropzone" class="dropzone conversion-upload"><img src="${toolIcon(tool.id)}" alt=""><strong>点击选择或拖入文件</strong><small>${escape(tool.accept)}${tool.multiple ? ' · 可选择多份文件' : ' · 每次选择一份文件'}</small></button><button type="button" class="secondary" id="append-files">追加文件</button><input type="file" id="append-upload" hidden accept="${tool.accept}" ${tool.multiple ? 'multiple' : ''}><p class="muted">最多 30 个文件，总大小 32 MB。文件按选择顺序处理。</p><div id="filelist" class="filelist"></div></section><section class="panel"><h2>处理参数</h2>${tool.params.map(([key, label, values, value]) => `<label>${escape(label)}${values ? `<select data-param="${key}">${values.map(entry => { const [id, text] = Array.isArray(entry) ? entry : [entry, entry]; return `<option value="${escape(id)}" ${id === value ? 'selected' : ''}>${escape(text)}</option>` }).join('')}</select>` : `<input data-param="${key}" value="${escape(value)}">`}</label>`).join('')}</section></div><div class="actions"><button class="secondary" id="back">返回</button><button class="primary" id="review">下一步：确认任务</button></div>`
  document.querySelectorAll('[data-param]').forEach(node => { node.value = options[node.dataset.param] ?? '' })
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
const imagePreviews = new Map()
function releaseImagePreviews(retained = []) {
  for (const [file, url] of imagePreviews) {
    if (retained.includes(file)) continue
    URL.revokeObjectURL(url)
    imagePreviews.delete(file)
  }
}
function imagePreviewMarkup(file) {
  if (!/\.(jpg|jpeg|png|webp)$/i.test(file.name) || typeof Blob !== 'function' || !(file instanceof Blob)) return ''
  if (!imagePreviews.has(file)) imagePreviews.set(file, URL.createObjectURL(file))
  return `<img class="file-preview" src="${escape(imagePreviews.get(file))}" alt="" loading="lazy">`
}
function updateFileList() {
  releaseImagePreviews(selectedFiles)
  const list = document.querySelector('#filelist')
  list.innerHTML = selectedFiles.map((file, index) => `<div class="file-entry"><span>${imagePreviewMarkup(file)}${index + 1}. ${escape(file.name)} <small class="muted">${(file.size / 1024).toFixed(1)} KB</small></span><div><button type="button" data-up="${index}" aria-label="上移 ${escape(file.name)}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-down="${index}" aria-label="下移 ${escape(file.name)}" ${index === selectedFiles.length - 1 ? 'disabled' : ''}>↓</button><button type="button" data-remove="${index}" aria-label="移除 ${escape(file.name)}">移除</button></div></div>`).join('')
  list.querySelectorAll('[data-up]').forEach(node => node.onclick = () => moveFile(Number(node.dataset.up), -1))
  list.querySelectorAll('[data-down]').forEach(node => node.onclick = () => moveFile(Number(node.dataset.down), 1))
  list.querySelectorAll('[data-remove]').forEach(node => node.onclick = () => {
    selectedFiles.splice(Number(node.dataset.remove), 1)
    updateFileList()
  })
}
function review() {
  if (selectedTool.id === 'pdf-organize' && options.mode !== 'merge' && selectedFiles.length !== 1) return toast('拆分模式只能选择一个 PDF 文件')
  if (selectedTool.id === 'pdf-organize' && options.mode === 'ranges' && !options.pages?.trim()) return toast('请填写拆分页码范围')
  const numeric = selectedTool.id === 'image-optimize' ? [['quality', 1, 100], ['maxWidth', 1, 10000], ['maxHeight', 1, 10000]] : selectedTool.id === 'images-pdf' ? [['margin', 0, 50]] : []
  for (const [key, minimum, maximum] of numeric) {
    const value = Number(options[key])
    if (!String(options[key]).trim() || !Number.isInteger(value) || value < minimum || value > maximum) return toast(`${selectedTool.params.find(param => param[0] === key)[1]}须为 ${minimum}–${maximum} 的整数`)
  }
  if (!selectedFiles.length || selectedFiles.length > 30 || selectedFiles.reduce((sum, file) => sum + file.size, 0) > 32 * 1024 * 1024) return toast('请选择 1–30 个文件，总大小不超过 32 MB')
  main.innerHTML = `<h1>核对处理信息</h1><div class="stepbar"><span>1 准备文件</span><span class="current">2 核对信息</span><span>3 处理与结果</span></div><section class="panel review conversion-review"><h2>${escape(options.taskName?.trim() || selectedTool.name)}</h2><dl class="conversion-details"><dt>处理类型</dt><dd>${escape(selectedTool.name)}</dd><dt>输入文件</dt><dd>${selectedFiles.map(file => escape(file.name)).join('<br>')}</dd>${selectedTool.params.length ? selectedTool.params.map(([key, label, values]) => `<dt>${escape(label)}</dt><dd>${escape(parameterText(selectedTool, key, values, options[key]))}</dd>`).join('') : '<dt>处理设置</dt><dd>无需额外设置</dd>'}<dt>预计成果</dt><dd>${escape(expectedOutputs(selectedTool, options, selectedFiles.length))}<small class="muted">实际成果以任务完成后生成的文件为准。</small></dd></dl></section><div class="actions"><button class="secondary" id="return">返回修改</button><button class="primary" id="start">开始处理</button></div>`
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
window.addEventListener('pagehide', () => { clearInterval(timer); releaseImagePreviews() })
boot()
