// Local-only visual fixture. It never contacts a deployed service or writes task data.
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [url, outputDirectory] = process.argv.slice(2)
if (!url?.startsWith('http://127.0.0.1:') || !outputDirectory) {
  throw new Error('Usage: node visual_audit.mjs <local preview URL> <screenshot directory>')
}
const profile = await mkdtemp(join(tmpdir(), 'meeting-visual-chrome-'))
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900',
  'about:blank',
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
  function call(method, params = {}) {
    const id = ++sequence
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
  }
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Page.navigate', { url })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate("document.querySelector('#main')?.textContent?.includes('会议纪要专家')")) break
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
  const fixture = `tasks = [{ id: 'a'.repeat(32), tool: 'minutes', options: { taskName: '项目周例会', title: '项目周例会' }, inputs: ['meeting.wav', 'agenda.docx'], input_names: ['meeting.wav', 'agenda.docx'], created: 1790388000, state: 'queued', outputs: [] }]; selectedTask = tasks[0].id;`
  const richSummary = '# 会议结论\n- **完成方案复核**\n1. 核对实施计划\n\n## 待办事项\n| 负责人 | 工作事项 | 截止时间 | 依赖条件 | 复核结果 |\n| --- | --- | --- | --- | --- |\n| 项目组 | 核对实施计划 | 未明确 | 等待资料 | <script>不执行</script> |'
  const shots = [
    ['01-home', "currentPage = 'home'; render()"],
    ['02-prepare', "form(tools[0]); selectedFiles = [{ name: 'meeting.wav', size: 123456 }, { name: 'agenda.docx', size: 2048 }]; updateFileList()"],
    ['03-review', 'review()'],
    ['04-queued', `${fixture} currentPage = 'result'; render()`],
    ['05-running', "tasks[0].state = 'running'; render()"],
    ['06-failed', "tasks[0].state = 'failed'; tasks[0].error = '录音转写失败，请检查音频文件后重试'; render()"],
    ['07-success', "tasks[0].state = 'succeeded'; tasks[0].error = ''; tasks[0].outputs = ['项目周例会-会议纪要.docx']; executionSummaries.set(tasks[0].id, { text: '会议结论：本周完成方案复核。\\n待办事项：项目组核对实施计划。', truncated: false }); render()"],
    ['08-history', "currentPage = 'history'; render()"],
    ['09-files', "currentPage = 'files'; render()"],
    ['10-guide', "currentPage = 'guide'; render()"],
    ['11-empty-history', "tasks = []; currentPage = 'history'; render()"],
    ['12-rich-summary', `${fixture} tasks[0].state = 'succeeded'; tasks[0].outputs = ['项目周例会-会议纪要.docx']; executionSummaries.set(tasks[0].id, { text: ${JSON.stringify(richSummary)}, truncated: false }); currentPage = 'result'; render()`],
  ]
  for (const [name, expression] of shots) {
    await evaluate(expression)
    if (name === '05-running') {
      await evaluate('tasks[0].created=Date.now()/1000-65; render()')
      const before = await evaluate("document.querySelector('[data-meeting-created]').textContent")
      await delay(1200)
      const live = await evaluate("({text:document.querySelector('[data-meeting-created]').textContent, animation:getComputedStyle(document.querySelector('.meeting-wave i')).animationName, font:getComputedStyle(document.querySelector('.meeting-task-info p')).fontSize})")
      if (live.text === before || live.animation !== 'meeting-wave-pulse' || live.font !== '16px') throw new Error('Meeting waiting clock, animation or source typography is incorrect')
      const balance = await evaluate("Math.abs(document.querySelector('.meeting-waiting-active').getBoundingClientRect().bottom-document.querySelector('.meeting-task-info').getBoundingClientRect().bottom)")
      if (balance > 1) throw new Error('Active meeting cards do not share the same bottom alignment')
    }
    await delay(180)
    const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(join(outputDirectory, `${name}.png`), Buffer.from(data, 'base64'))
  }
  for (const width of [900, 760]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    for (const state of ['running', 'failed', 'succeeded']) {
      await evaluate(`${fixture} tasks[0].state = '${state}'; tasks[0].outputs = ['项目周例会-会议纪要.docx']; currentPage = 'result'; render()`)
      await delay(180)
      const layout = await evaluate(`({ overflow: document.documentElement.scrollWidth > innerWidth || document.querySelector('#main').scrollWidth > document.querySelector('#main').clientWidth, grid: !!document.querySelector('.meeting-result-grid'), downloads: document.querySelectorAll('.meeting-deliverable a').length })`)
      if (layout.overflow || !layout.grid || layout.downloads !== (state === 'succeeded' ? 1 : 0)) {
        throw new Error(`Invalid ${width}px ${state} result layout: ${JSON.stringify(layout)}`)
      }
      if (state === 'succeeded') {
        const rich = await evaluate(`({ headings: document.querySelectorAll('.meeting-answer h4').length, points: document.querySelectorAll('.meeting-answer-point').length, table: !!document.querySelector('.meeting-answer-table table'), audio: !!document.querySelector('.meeting-task-info img[src="/assets/audio.png"]'), script: !!document.querySelector('.meeting-answer script') })`)
        if (rich.headings !== 2 || rich.points !== 2 || !rich.table || !rich.audio || rich.script) throw new Error(`Invalid rich summary: ${JSON.stringify(rich)}`)
      }
      const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      await writeFile(join(outputDirectory, `result-${state}-${width}.png`), Buffer.from(data, 'base64'))
    }
  }
  socket.close()
  process.stdout.write(`${shots.length + 6} local screenshots: ${outputDirectory}\n`)
} finally {
  chrome.kill()
}
