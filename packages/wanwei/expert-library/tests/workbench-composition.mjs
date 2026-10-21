/** Real desktop profile and CSS; only the remote backend and OS bridge are fixtures. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { ensureProductProfile } from '../../../../products/wanwei-desktop/scripts/product-profile.mjs'

const root = resolve(import.meta.dirname, '../../../..')
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('playwright')
const home = await mkdtemp(join(tmpdir(), 'wanwei-expert-layout-'))
ensureProductProfile(home)
const experts = ['first-expert', 'second-expert'].map((key, index) => ({
  key, name: `布局专家${index + 1}`, workbench_url: 'https://example.com/',
}))
let launches = 0
const backend = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json')
  if (/\/api\/expert-web\/[^/]+\/launch$/.test(request.url)) {
    launches++
    response.end(JSON.stringify({ success: true, url: 'https://example.com/', ticket: 'a'.repeat(64) })); return
  }
  const data = request.url === '/api/desktop-config' ? { network: 'internet', operator: 'fixture', phone: '' }
    : request.url === '/api/expert-web/' ? experts : []
  response.end(JSON.stringify({ success: true, data }))
})
await new Promise(done => backend.listen(0, '127.0.0.1', done))
const child = spawn(process.execPath, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts',
  '--profile', 'wanwei-desktop', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DSH_HOME: home, DSH_DESKTOP_DEVELOPMENT: '1', DSH_ONEAPI_TOKEN: 'fixture-token',
    DSH_ONEAPI_URL: `http://127.0.0.1:${backend.address().port}`,
    DSH_BUNDLE_ANCHORS: join(root, 'products/wanwei-desktop/package.json') },
})
let output = ''
child.stdout.on('data', chunk => { output += chunk.toString() })
child.stderr.on('data', chunk => { output += chunk.toString() })
const exited = new Promise(done => child.once('exit', done))
let browser
try {
  const deadline = Date.now() + 90000
  let match
  while (!(match = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/))) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error('Desktop profile failed to start')
    await new Promise(done => setTimeout(done, 100))
  }
  const channel = process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined)
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    window.__expertCalls = []
    window.__ZJUGIS_NATIVE_INVOKE__ = async (command, args) => {
      window.__expertCalls.push({ command, args })
      return command === 'open_expert_webview' ? `view-${args.key}` : undefined
    }
    window.__TAURI_INTERNALS__ = { invoke: async () => undefined }
  })
  await page.goto(match[0])
  await page.getByRole('button', { name: '专家库', exact: true }).click({ timeout: 30000 })
  await page.locator('.dsh-expert-card').first().click()
  await page.getByRole('button', { name: '开始使用', exact: true }).click()
  const holder = page.locator('.dsh-expert-webview:visible')
  const assertBounds = async (width, height) => {
    await page.setViewportSize({ width, height })
    await page.waitForFunction(() => {
      const node = document.querySelector('.dsh-expert-webview:not([style*="display: none"])')
      const rect = node?.getBoundingClientRect()
      return rect && rect.width >= 200 && rect.height >= 200
    }, undefined, { timeout: 5000 })
    const box = await holder.boundingBox()
    assert.ok(box.width >= 200 && box.height >= 200, JSON.stringify(box))
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1)
    await page.waitForFunction(() => window.__expertCalls.some(call =>
      call.command === 'set_expert_webview_bounds' && call.args.height >= 200))
    assert.equal(await page.locator('[role="alert"]').count(), 0)
  }
  for (const size of [[1280, 900], [1024, 768], [1440, 1000]]) await assertBounds(...size)
  await page.getByRole('button', { name: '专家', exact: true }).click()
  await page.locator('.dsh-expert-card').nth(1).click()
  await page.getByRole('button', { name: '开始使用', exact: true }).click()
  await assertBounds(1280, 900)
  await page.getByRole('button', { name: '布局专家1', exact: true }).click()
  await assertBounds(1024, 768)
  assert.equal(launches, 2)
  assert.equal(await page.evaluate(() => window.__expertCalls.filter(call => call.command === 'open_expert_webview').length), 2)
  await page.getByRole('button', { name: '关闭布局专家1标签', exact: true }).click()
  await assertBounds(1280, 900)
  await page.getByRole('button', { name: '关闭布局专家2标签', exact: true }).click()
  await page.locator('.dsh-expert-card').first().waitFor()
  assert.equal(await page.locator('.dsh-expert-webview').count(), 0)
  assert.equal(await page.locator('.dsh-expert-view-open').count(), 0)
  assert.deepEqual(errors, [])
  console.log('PASS: real profile/CSS expert launch, resize, tab reuse, close and catalog restoration')
} finally {
  await browser?.close()
  backend.closeAllConnections()
  await new Promise(done => backend.close(done))
  child.kill()
  await Promise.race([exited, new Promise(done => setTimeout(done, 3000))])
  assert.ok(home.startsWith(join(tmpdir(), 'wanwei-expert-layout-')))
  await rm(home, { recursive: true, force: true })
}
