const $ = selector => document.querySelector(selector)

async function api(path, options) {
  const response = await fetch(path, { credentials: 'same-origin', ...options })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || '请求失败')
  return body
}

function notice(message) {
  const element = $('#message')
  element.textContent = message
  element.hidden = false
  clearTimeout(notice.timer)
  notice.timer = setTimeout(() => { element.hidden = true }, 5000)
}

function renderTask(task) {
  const article = document.createElement('article')
  article.className = 'record'
  const title = document.createElement('h2')
  title.textContent = task.name
  const description = document.createElement('p')
  description.textContent = `${task.lines} 行 · ${task.bytes} 字节 · SHA-256 ${task.sha256}`
  const link = document.createElement('a')
  link.href = `/api/tasks/${task.id}/report`
  link.textContent = '下载检查报告'
  article.append(title, description, link)
  return article
}

async function refreshTasks() {
  const { items } = await api('/api/tasks')
  $('#task-list').replaceChildren(...items.map(renderTask))
}

async function init() {
  const fragment = new URLSearchParams(location.hash.slice(1))
  const ticket = fragment.get('ticket')
  history.replaceState(null, '', location.pathname + location.search)
  try {
    if (ticket) await api('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket }) })
    await refreshTasks()
    $('#identity').textContent = '已连接专家工作台'
    $('#connection-state').textContent = '可用'
    $('#run').disabled = false
  } catch (error) {
    $('#identity').textContent = '请从万维 Buddy 专家库重新打开'
    $('#connection-state').textContent = '未连接'
    notice(error.message)
  }
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('active', item === button))
  document.querySelectorAll('.view').forEach(view => { view.hidden = view.id !== button.dataset.view })
  if (button.dataset.view === 'records') void refreshTasks().catch(error => notice(error.message))
}))

$('#run').addEventListener('click', async () => {
  const file = $('#file').files[0]
  if (!file) return notice('请先选择文件')
  if (file.size > 5 * 1024 * 1024) return notice('文件不能超过 5 MB')
  $('#run').disabled = true
  try {
    const content = btoa(Array.from(new Uint8Array(await file.arrayBuffer()), byte => String.fromCharCode(byte)).join(''))
    const { item } = await api('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: file.name, content }) })
    $('#result').replaceChildren(renderTask(item))
    await refreshTasks()
    notice('检查报告已生成')
  } catch (error) { notice(error.message) }
  finally { $('#run').disabled = false }
})

$('#check-native').addEventListener('click', async () => {
  const status = $('#native-result')
  const invoke = window.__ZJUGIS_NATIVE_INVOKE__
  if (typeof invoke !== 'function') {
    status.textContent = '当前网页没有桌面原生桥；请从桌面端打开。'
    return
  }
  try {
    await invoke('list_custom_skills', {})
    status.textContent = '原生桥可用：已成功调用技能列表命令。'
  } catch (error) {
    status.textContent = `原生桥调用失败：${error instanceof Error ? error.message : String(error)}`
  }
})

void init()
