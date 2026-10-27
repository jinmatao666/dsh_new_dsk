/* Independent OCR workbench. All requests stay relative to its mounted path. */
const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const states = { queued: '等待处理', running: '正在识别', succeeded: '已完成', failed: '识别失败', cancelled: '已取消' };
const formats = { text: '纯文本', markdown: 'Markdown', json: 'JSON', csv: 'CSV表格' };
let authenticated = false;
let expired = false;
let config = { ready: false, preview: false };
let file = null;
let imageUrl = null;
let tasks = [];
let activeTask = null;
let resultText = '';
let example = false;
let page = 'home';
let submitting = false;
let selection = 0;
let pollRequest = 0;
let toastTimer;
const controllers = new Set();

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4200);
}
function clearImage() { if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = null; $('#source-image').removeAttribute('src'); $('#source-image').hidden = true; }
function expire() {
  expired = true; authenticated = false; selection++;
  controllers.forEach(controller => controller.abort());
  tasks = []; file = null; activeTask = null; resultText = '';
  clearImage(); $('#image-input').value = ''; $('#drop-zone').hidden = false;
  $('#file-bar>span').textContent = '登录已失效，已清除材料信息';
  $('#replace-image').hidden = true; $('#task-name').value = ''; $('#instruction').value = '';
  $('#instruction-count').textContent = '0 / 2000';
  $('#result-content').textContent = ''; $('#result-content').hidden = true;
  $('#download-result').hidden = true; $('#copy-result').disabled = true;
  $('#running-panel').hidden = true; $('#result-empty').hidden = false;
  $('#task-list').textContent = ''; $('#output-list').textContent = '';
  $('#task-count').textContent = '0';
  document.body.classList.add('expired');
  $('#auth-message').hidden = false;
  $('#auth-message').textContent = '登录已失效。请关闭本页，从万维 Buddy 专家库重新打开；本页不会自动复用旧票据。';
  $('#service-status').textContent = '需要重新登录';
  updateButton();
}
async function api(path, data) {
  if (expired) throw new Error('登录已失效，请重新打开专家');
  const controller = new AbortController();
  controllers.add(controller);
  try {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      ...(data !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}) });
    if (response.status === 401) { expire(); throw new Error('请从万维 Buddy 专家库重新打开工作台'); }
    const value = await response.json();
    if (expired) throw new Error('登录已失效');
    if (!response.ok) throw new Error(value.error || `请求失败（${response.status}）`);
    return value;
  } finally { controllers.delete(controller); }
}
function updateButton() {
  const mode = $('#ocr-form input[name="mode"]:checked').value;
  const busy = submitting || (activeTask && ['queued', 'running'].includes(activeTask.state));
  $('#start-button').disabled = !authenticated || !config.ready || !file || busy || (mode === 'custom' && !$('#instruction').value.trim());
  $('#start-button').lastChild.textContent = submitting ? ' 正在上传…' : '开始识别';
}
function resetResult() {
  resultText = ''; example = false;
  $('#result-content').hidden = true; $('#result-content').textContent = '';
  $('#result-empty').hidden = false; $('#running-panel').hidden = true;
  $('#copy-result').disabled = true; $('#download-result').hidden = true;
  $('#download-result').removeAttribute('href');
  $('#result-badge').textContent = '等待识别';
  $('#result-empty strong').textContent = '把图像交给专家，文字留给你。';
  $('#result-empty p').textContent = '上传图片并开始识别后，结果将在这里显示。';
  $('#result-note').textContent = '金额、日期、编号、联系方式等关键字段，请逐项对照原图复核。';
}
function setPage(next) {
  page = next;
  for (const key of ['home', 'history', 'files', 'guide']) $(`#${key}-page`).hidden = key !== next;
  document.querySelectorAll('nav [data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === next));
  $('#page-title').textContent = { home: '图像文字识别', history: '任务记录', files: '成果文件', guide: '使用指南' }[next];
  if (next === 'history' || next === 'files') renderTasks();
}
function newTask() {
  selection++; activeTask = null; file = null;
  clearImage(); resetResult(); $('#drop-zone').hidden = false;
  $('#image-input').value = ''; $('#file-bar>span').textContent = '清晰、完整的原图有助于准确提取';
  $('#replace-image').hidden = true;
  $('#task-name').value = '';
  setPage('home'); updateButton();
}
function chooseFile(next) {
  if (!authenticated) { toast('请先从专家库登录，或使用本地预览入口'); return; }
  if (!next || !/\.(png|jpe?g|webp)$/i.test(next.name) || next.size > 10 * 1024 * 1024 || !next.size) { toast('请选择不超过10 MB的PNG、JPG或WebP图片'); return; }
  selection++; activeTask = null; file = next;
  clearImage(); resetResult();
  imageUrl = URL.createObjectURL(next); $('#source-image').src = imageUrl; $('#source-image').hidden = false;
  $('#drop-zone').hidden = true; $('#replace-image').hidden = false;
  $('#file-bar>span').textContent = `${next.name} · ${(next.size / 1024).toFixed(0)} KB`;
  updateButton();
}
$('#image-input').addEventListener('change', event => chooseFile(event.target.files[0]));
$('#replace-image').addEventListener('click', () => $('#image-input').click());
$('#new-task').addEventListener('click', newTask);
document.querySelectorAll('nav [data-page]').forEach(button => button.addEventListener('click', () => setPage(button.dataset.page)));
$('.expert-brand').addEventListener('click', event => { event.preventDefault(); setPage('home'); });
$('#image-stage').addEventListener('dragover', event => { event.preventDefault(); $('#drop-zone').classList.add('drag-over'); });
$('#image-stage').addEventListener('dragleave', () => $('#drop-zone').classList.remove('drag-over'));
$('#image-stage').addEventListener('drop', event => { event.preventDefault(); $('#drop-zone').classList.remove('drag-over'); if (event.dataTransfer.files.length !== 1) return toast('每次只接受一张图片'); chooseFile(event.dataTransfer.files[0]); });
document.querySelectorAll('input[name="mode"]').forEach(input => input.addEventListener('change', () => {
  const custom = input.value === 'custom' && input.checked;
  $('#instruction').disabled = !custom;
  $('#instruction-help').textContent = custom ? '说明要提取的字段、内容或整理规则，不会补造图片中缺失的信息。' : '全文提取模式无需填写额外要求。';
  document.querySelectorAll('.mode-option').forEach(label => label.classList.toggle('selected', label.querySelector('input').checked));
  updateButton();
}));
$('#instruction').addEventListener('input', () => { $('#instruction-count').textContent = `${$('#instruction').value.length} / 2000`; updateButton(); });
document.querySelectorAll('input[name="format"]').forEach(input => input.addEventListener('change', () => {
  $('#format-help').textContent = { text: '适合直接复制使用，导出为TXT文件。', markdown: '保留段落和表格结构，导出为Markdown文件。', json: '按字段整理为JSON；无效结构不会作为成功结果发布。', csv: '首行为字段名，导出适合表格软件打开的CSV文件。' }[input.value];
}));
const base64 = image => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(image); });
$('#ocr-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!authenticated || !config.ready || !file || submitting) return;
  const current = file; const revision = selection;
  submitting = true; updateButton();
  const options = { taskName: $('#task-name').value.trim(), mode: $('#ocr-form input[name="mode"]:checked').value, format: $('#ocr-form input[name="format"]:checked').value, instruction: $('#instruction').value.trim() };
  try {
    const content = await base64(current);
    if (revision !== selection || expired) return;
    const result = await api('api/tasks', { tool: 'ocr', files: [{ name: current.name, content }], options });
    await refreshTasks();
    if (revision === selection) await openTask(result.id);
    toast('识别任务已提交');
  } catch (error) { if (!expired) toast(error.message); }
  finally { submitting = false; updateButton(); }
});

function renderTasks() {
  $('#task-count').textContent = String(tasks.length);
  $('#task-list').innerHTML = tasks.length ? tasks.map(task => `<article class="panel task-row"><span class="task-glyph"><svg class="icon"><use href="#file"/></svg></span><div class="task-info"><strong>${escape(task.options.taskName || task.input_names[0] || '文字识别任务')}</strong><small>${escape(new Date(task.created * 1000).toLocaleString())} · ${escape(formats[task.options.format])}${task.error ? ' · ' + escape(task.error) : ''}</small></div><span class="task-state ${escape(task.state)}">${escape(states[task.state] || task.state)}</span><button data-open="${escape(task.id)}">查看任务</button></article>`).join('') : '<div class="panel empty-list">暂无识别任务，从一张图片开始。</div>';
  const outputs = tasks.filter(task => task.state === 'succeeded').flatMap(task => task.outputs.map((name, index) => ({ task, name, index })));
  $('#output-list').innerHTML = outputs.length ? outputs.map(({ task, name, index }) => `<article class="panel task-row"><span class="task-glyph"><svg class="icon"><use href="#file"/></svg></span><div class="task-info"><strong>${escape(name)}</strong><small>${escape(task.options.taskName || task.input_names[0])} · ${escape(new Date(task.created * 1000).toLocaleString())}</small></div><button data-save="api/tasks/${escape(task.id)}/files/${index}" data-name="${escape(name)}">下载文件</button></article>`).join('') : '<div class="panel empty-list">暂无成果文件。只有实际完成的任务才会出现在这里。</div>';
}
async function refreshTasks() {
  const revision = ++pollRequest;
  const value = await api('api/tasks');
  if (revision !== pollRequest || expired) return;
  tasks = value.items;
  renderTasks();
  if (activeTask) {
    const updated = tasks.find(task => task.id === activeTask.id);
    if (updated && updated.state !== activeTask.state) await openTask(updated.id, false);
  }
}
async function openTask(id, navigate = true) {
  const task = tasks.find(item => item.id === id);
  if (!task || expired) return;
  const revision = ++selection;
  activeTask = task; file = null; clearImage(); resetResult();
  if (navigate) setPage('home');
  $('#source-image').src = `api/tasks/${task.id}/image`; $('#source-image').hidden = false;
  $('#drop-zone').hidden = true; $('#replace-image').hidden = false;
  $('#file-bar>span').textContent = task.input_names[0];
  $('#task-name').value = task.options.taskName || '';
  $('#result-badge').textContent = states[task.state];
  if (['queued', 'running'].includes(task.state)) {
    $('#result-empty').hidden = true; $('#running-panel').hidden = false;
    $('#running-status').textContent = task.state === 'queued' ? '任务正在排队，受理不等于已经识别成功。' : '正在请求识别服务。取消只停止本地等待，远程服务可能仍继续处理。';
  } else if (task.state === 'failed' || task.state === 'cancelled') {
    $('#result-empty strong').textContent = task.state === 'failed' ? '本次识别未完成，没有发布成果。' : '任务已取消，没有发布成果。';
    $('#result-empty p').textContent = task.error || '请新建任务后重新提交。';
  } else if (task.state === 'succeeded') {
    try {
      const result = await api(`api/tasks/${task.id}/result`);
      if (revision !== selection || expired) return;
      resultText = result.text;
      $('#result-content').textContent = resultText; $('#result-content').hidden = false;
      $('#result-empty').hidden = true; $('#copy-result').disabled = false;
      $('#download-result').hidden = false; $('#download-result').href = `api/tasks/${task.id}/files/0`;
      $('#download-result').dataset.name = task.outputs[0];
      $('#result-note').textContent = `本次输出：${formats[result.format]}。${task.options.mode === 'custom' ? '按自定义要求提取' : '全文提取'}；关键字段请对照原图核对。`;
    } catch (error) { if (!expired && revision === selection) toast(error.message); }
  }
  updateButton();
}
$('#refresh-tasks').addEventListener('click', () => refreshTasks().then(() => toast('任务记录已刷新')).catch(error => toast(error.message)));
$('#task-list').addEventListener('click', event => { const button = event.target.closest('[data-open]'); if (button) openTask(button.dataset.open).catch(error => toast(error.message)); });
$('#cancel-task').addEventListener('click', async () => { if (!activeTask) return; try { await api(`api/tasks/${activeTask.id}/cancel`, {}); await refreshTasks(); } catch (error) { if (!expired) toast(error.message); } });
$('#copy-result').addEventListener('click', async () => { if (!resultText || expired) return; try { await navigator.clipboard.writeText(resultText); toast(example ? '示例文字已复制，不是实际识别结果' : '识别结果已复制'); } catch { toast('当前环境无法写入剪贴板，请选中结果文字手动复制。'); } });
async function saveFile(path, name) {
  if (expired || !authenticated) return;
  const controller = new AbortController(); controllers.add(controller);
  try {
    const response = await fetch(path, { credentials: 'same-origin', signal: controller.signal });
    if (response.status === 401) { expire(); throw new Error('登录已失效'); }
    if (!response.ok) throw new Error('文件下载失败');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (expired) return;
    if (typeof window.__ZJUGIS_NATIVE_INVOKE__ === 'function') {
      let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      const saved = await window.__ZJUGIS_NATIVE_INVOKE__('save_expert_artifact', { fileName: name, bytesBase64: btoa(binary) });
      if (saved && !expired) toast('成果文件已保存');
    } else {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
      const link = document.createElement('a'); link.href = url; link.download = name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  } catch (error) { if (!expired) toast(error.message); }
  finally { controllers.delete(controller); }
}
$('#download-result').addEventListener('click', event => { event.preventDefault(); saveFile($('#download-result').getAttribute('href'), $('#download-result').dataset.name); });
$('#output-list').addEventListener('click', event => { const button = event.target.closest('[data-save]'); if (button) saveFile(button.dataset.save, button.dataset.name); });
$('#sample-button').addEventListener('click', () => {
  if (expired) return toast('请先重新登录');
  selection++; activeTask = null; file = null; clearImage(); resetResult(); example = true;
  $('#source-image').src = 'assets/sample-form.svg'; $('#source-image').hidden = false;
  $('#drop-zone').hidden = true; $('#replace-image').hidden = !authenticated;
  $('#file-bar>span').textContent = '展示示例 · 非真实业务材料';
  resultText = '项目名称：青禾公共空间改造项目\n联系日期：2026年10月20日\n发起部门：项目协调组\n\n资料整理：核对项目名称与版本日期\n图纸核对：补充公共设施位置说明\n下一步：整理问题清单，提交项目组复核\n\n备注：待确认信息请勿自行补填。\n联系人：待补充\n联系电话：待补充';
  $('#result-content').textContent = resultText; $('#result-content').hidden = false; $('#result-empty').hidden = true;
  $('#result-badge').textContent = '展示示例'; $('#copy-result').disabled = false;
  $('#result-note').textContent = '这是预置的图像与文字展示，不是OCR实际调用结果，不进入任务历史或成果文件。';
  updateButton();
});

async function initialize() {
  const ticket = new URLSearchParams(location.hash.slice(1)).get('ticket');
  if (ticket) history.replaceState(null, '', location.pathname);
  try {
    if (ticket) await api('api/session', { ticket });
    config = await api('api/config'); authenticated = true;
    $('#service-status').textContent = config.ready ? '识别服务已配置' : '识别服务待配置';
    $('#service-status').classList.toggle('ready', config.ready);
    if (config.preview || !config.ready) {
      $('#auth-message').hidden = false;
      $('#auth-message').textContent = config.preview ? '本地页面预览：仅使用一次性测试身份，不是生产票据联调。示例不是实际识别结果；真实识别仍需配置PaddleOCR服务。' : 'PaddleOCR服务尚未配置。全文识别由PaddleOCR完成；自定义字段整理另需文字模型。';
    }
    await refreshTasks();
  } catch (error) {
    if (!expired) { $('#auth-message').hidden = false; $('#auth-message').textContent = error.message; $('#service-status').textContent = '连接失败，请刷新重试'; }
  }
  updateButton();
}
setInterval(() => { if (authenticated && !expired && !document.hidden && tasks.some(task => ['queued', 'running'].includes(task.state))) refreshTasks().catch(error => { if (!expired) toast(error.message); }); }, 4000);
initialize();
