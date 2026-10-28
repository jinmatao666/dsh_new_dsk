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
 assert.equal(JSON.parse(lines[0].content).text, 'FEISHU_DESKTOP_RESULT')
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
 console.log('Real desktop profile: duplicate Feishu events produced one persisted task and one reply to the original message.')
} finally {
 await browser?.close()
 child.kill(); await Promise.race([exited, new Promise(done => setTimeout(done, 3000))])
 backend.closeAllConnections(); await new Promise(done => backend.close(done))
 assert(fixture.startsWith(join(tmpdir(), 'wanwei-feishu-composition-')))
 await rm(fixture, { recursive: true, force: true })
}
