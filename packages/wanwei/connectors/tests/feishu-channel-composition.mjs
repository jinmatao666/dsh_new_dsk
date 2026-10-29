/** Real shipped desktop profile. Only the external CLI and model HTTP server are fixtures. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { zstdDecompressSync } from 'node:zlib'
import { scanZstdFrames } from '../../../session/session-persistence-jsonl/src/zstd.ts'
import { ensureProductProfile } from '../../../../products/wanwei-desktop/scripts/product-profile.mjs'
const root = resolve(import.meta.dirname, '../../../..')
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('playwright')
const fixture = await mkdtemp(join(tmpdir(), 'wanwei-feishu-composition-'))
const home = join(fixture, 'home')
const executable = join(fixture, process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli')
const built = spawnSync('go', ['build', '-o', executable, 'packages/wanwei/connectors/tests/fixtures/feishu-cli/main.go'], { cwd: root, windowsHide: true, encoding: 'utf8' })
assert.equal(built.status, 0, built.stderr)
await cp(join(root, 'products/wanwei-desktop/assets/lark-1.0.98/skills'), join(fixture, 'skills'), { recursive: true })
ensureProductProfile(home)
await writeFile(join(home, '.credentials.yaml'), 'version: 1\nrefs:\n  DSH_ONEAPI_TOKEN: fixture-token\n', { mode: 0o600 })
await mkdir(join(home, 'feishu-assistant'), { recursive: true })
await writeFile(join(home, 'feishu-assistant/channel.json'), JSON.stringify({ enabled: true, appId: 'cli_fixture', openId: 'ou_owner', since: Date.now(), seen: [] }))
let modelCalls = 0
const requests = []
const backend = createServer(async (request, response) => {
 requests.push(request.url)
 if (request.url?.includes('/chat/completions')) {
  let body = ''; for await (const chunk of request) body += chunk
  const input = JSON.parse(body)
  assert(input.messages.some(message => JSON.stringify(message).includes('FROM_FEISHU_ONLY_ONCE')))
  modelCalls++
  response.setHeader('Content-Type', 'text/event-stream')
  if (modelCalls === 1) {
   response.end('data: '+JSON.stringify({ id:'question', object:'chat.completion.chunk', choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'ask_scope',type:'function',function:{name:'ask_user_question',arguments:JSON.stringify({questions:[{id:'scope',question:'选择新闻范围？',options:[{label:'国内新闻'},{label:'国际新闻'}]}]})}}]},finish_reason:null}]})+'\n\n'
    +'data: '+JSON.stringify({id:'question',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n')
   return
  }
  if (modelCalls === 2) assert(input.messages.some(message => message.role === 'tool' && message.content.includes('国内新闻')))
  response.end('data: '+JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'FEISHU_DESKTOP_RESULT' }, finish_reason: null }] })+'\n\n'
   +'data: '+JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })+'\n\ndata: [DONE]\n\n')
  return
 }
 response.setHeader('Content-Type', 'application/json')
 if (request.url === '/v1/models') { response.end(JSON.stringify({ data: [{ id: 'fixture-model' }] })); return }
 if (request.url === '/api/user/available_models/detail') { response.end(JSON.stringify({ success: true, data: [{ id: 'fixture-model', name: 'Fixture model', modalities: { input: ['text'] } }] })); return }
 if (request.url === '/api/status') { response.end(JSON.stringify({ data: { default_model: 'fixture-model' } })); return }
 response.end(JSON.stringify({ success: true, data: request.url === '/api/desktop-config' ? { network: 'internet', operator: '', phone: '' } : [] }))
})
await new Promise(done => backend.listen(0, '127.0.0.1', done))
const child = spawn(process.execPath, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'wanwei-desktop', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
 cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, DSH_HOME: home, DSH_DESKTOP_DEVELOPMENT: '0', DSH_INSTALL_ID: '', DSH_ONEAPI_TOKEN: 'fixture-token',
 DSH_DEFAULT_MODEL: 'fixture-model', DSH_ONEAPI_URL: `http://127.0.0.1:${backend.address().port}`, DSH_LARK_CLI: executable, DSH_FEISHU_FIXTURE: fixture,
 DSH_BUNDLE_ANCHORS: join(root, 'products/wanwei-desktop/package.json') },
})
let output = ''; child.stdout.on('data', b => { output += b }); child.stderr.on('data', b => { output += b })
const exited = new Promise(done => child.once('exit', done))
let browser
try {
 const deadline = Date.now()+120000
 while (!output.includes('http://127.0.0.1:')) {
  if (child.exitCode !== null || Date.now()>deadline) throw new Error(output)
  await new Promise(done => setTimeout(done, 100))
 }
 browser = await chromium.launch({ headless: true, channel: 'msedge' })
 const page = await browser.newPage()
 await page.goto(output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/)[0])
 await page.waitForFunction(() => document.title === '__zjugis_native_auth:authenticated', null, { timeout: 30000 }).catch(async error => {
  throw new Error(JSON.stringify({ title: await page.title(), text: (await page.locator('body').innerText()).slice(0, 4000), requests }) + '\n' + error.message)
 })
 await writeFile(join(fixture, 'incoming.json'), JSON.stringify({ type: 'im.message.receive_v1', sender_type: 'user', chat_type: 'p2p', message_type: 'text',
 message_id: 'om_fixture', chat_id: 'oc_fixture', sender_id: 'ou_owner', create_time: String(Date.now()), content: 'FROM_FEISHU_ONLY_ONCE' }))
 let replies
 while (!replies) {
  try { replies = (await readFile(join(fixture, 'replies.jsonl'), 'utf8')).trim() } catch {}
  if (child.exitCode !== null || Date.now()>deadline) throw new Error(output+'\nTimed out waiting for a real desktop reply.')
  await new Promise(done => setTimeout(done, 100))
 }
 const lines = replies.split('\n').map(line => JSON.parse(line))
 assert.equal(modelCalls, 1, JSON.stringify({ lines, requests }))
 assert.equal(lines.length, 1)
 assert.equal(lines[0].target, 'om_fixture')
 assert(JSON.parse(lines[0].content).text.includes('选择新闻范围'))
 await writeFile(join(fixture, 'incoming.json'), JSON.stringify({type:'im.message.receive_v1',sender_type:'user',chat_type:'p2p',message_type:'text',message_id:'om_answer',chat_id:'oc_fixture',sender_id:'ou_owner',create_time:String(Date.now()),content:'1'}))
 let initialReplies = []
 const answerDeadline = Date.now() + 30000
 while (initialReplies.length < 3 && Date.now() < answerDeadline) {
  initialReplies = (await readFile(join(fixture, 'replies.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  await new Promise(done => setTimeout(done, 100))
 }
 assert.equal(modelCalls, 2, JSON.stringify(initialReplies))
 assert.equal(initialReplies.length, 3)
 assert.equal(JSON.parse(initialReplies[2].content).text, 'FEISHU_DESKTOP_RESULT')
 const records = []
 async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
   const path = join(dir, entry.name)
   if (entry.isDirectory()) await scan(path)
   else if (entry.name === 'session.jsonl' || entry.name === 'session.jsonl.zstd') {
    const bytes = await readFile(path)
    const text = (entry.name.endsWith('.zstd')
     ? Buffer.concat(scanZstdFrames(bytes).frames.map(frame => zstdDecompressSync(bytes.subarray(frame.start, frame.end))))
     : bytes).toString('utf8')
    records.push(...text.trim().split('\n').map(line => JSON.parse(line)))
   }
  }
 }
 await scan(home)
 assert.equal(records.filter(event => event.type === 'user/message' && JSON.stringify(event.data.content).includes('FROM_FEISHU_ONLY_ONCE')).length, 1,
  JSON.stringify(records.map(event => ({ type: event.type, data: event.data }))))
 assert(records.some(event => event.type === 'assistant/message' && JSON.stringify(event.data).includes('FEISHU_DESKTOP_RESULT')))
 await page.getByText('飞书助理', { exact: true }).first().waitFor()
 if (await page.getByText('飞书助理', { exact: true }).count() === 1) await page.getByText('飞书助理', { exact: true }).first().click()
 await page.getByText('飞书助理', { exact: true }).nth(1).click()
 await page.getByText('FROM_FEISHU_ONLY_ONCE', { exact: true }).waitFor()
 const editor = page.locator('[contenteditable="true"]').first()
 await editor.fill('使用国内新闻 DESKTOP_FOLLOWUP')
 await page.getByRole('button', { name: '发送消息', exact: true }).click()
 let mirrored = []
 const followupDeadline = Date.now() + 30000
 while (mirrored.length < 5 && Date.now() < followupDeadline) {
  mirrored = (await readFile(join(fixture, 'replies.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  await new Promise(done => setTimeout(done, 100))
 }
 assert.equal(modelCalls, 3, JSON.stringify({ mirrored, page: (await page.locator('body').innerText()).slice(-5000) }))
 assert.equal(mirrored.length, 5, JSON.stringify(mirrored))
 assert(JSON.parse(mirrored[3].content).text.includes('DESKTOP_FOLLOWUP'))
 assert.equal(JSON.parse(mirrored[4].content).text, 'FEISHU_DESKTOP_RESULT')
 console.log('Real desktop profile: duplicate Feishu input ran once; desktop followup and assistant reply each synchronized once.')
} catch (error) {
 console.error(error)
 throw error
} finally {
 await browser?.close()
 if (process.platform === 'win32' && child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
 child.kill(); await Promise.race([exited, new Promise(done => setTimeout(done, 3000))])
 backend.closeAllConnections(); await new Promise(done => backend.close(done))
 assert(fixture.startsWith(join(tmpdir(), 'wanwei-feishu-composition-')))
 await rm(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
