/** Exercise the built product UI with an isolated profile; only the external backend is mocked. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { ensureProductProfile } from './product-profile.mjs'
import { loadBrand, productRoot } from './branding.mjs'
import { verifyBranding } from './verify-branding.mjs'

const selection = loadBrand()
await verifyBranding(selection)
const root = resolve(productRoot, '../..')
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('playwright')
const screenshots = process.argv[2] ? resolve(process.argv[2]) : undefined
if (screenshots) await mkdir(screenshots, { recursive: true })
const backend = createServer((request, response) => {
  const features = { automations: true, connectors: true }
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify({ success: true, data: request.url === '/api/desktop-config'
    ? { network: 'internet', operator: '', phone: '', features: { internet: features, intranet: features } }
    : request.url?.startsWith('/api/user/self/credits') ? { balance: 785.83, total: 0, items: [] }
      : request.url === '/api/user/self/checkin' ? { enabled: false, can_claim: false } : [] }))
})
await new Promise(done => backend.listen(0, '127.0.0.1', done))
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
try {
  for (const authenticated of [false, true]) {
    const home = await mkdtemp(join(tmpdir(), 'brand-composition-'))
    ensureProductProfile(home)
    const child = spawn(process.execPath, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'wanwei-desktop', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
      cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env,
        DSH_HOME: home, DSH_DESKTOP_DEVELOPMENT: authenticated ? '1' : '0',
        DSH_ONEAPI_TOKEN: authenticated ? 'local-brand-preview' : '', DSH_INSTALL_ID: '',
        DSH_ONEAPI_URL: `http://127.0.0.1:${backend.address().port}`,
        DSH_BUNDLE_ANCHORS: join(productRoot, 'package.json'), DSH_DESKTOP_PARENT_CONTROL: '1' },
    })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    const exited = new Promise(done => child.once('exit', done))
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      let url
      const deadline = Date.now() + 90000
      while (!(url = output.match(/dsh web: (http:\/\/[^\s]+)/u)?.[1])) {
        if (child.exitCode !== null || Date.now() > deadline) throw new Error(output.replace(/([?&]token=)[^\s&]+/gu, '$1[REDACTED]'))
        await new Promise(done => setTimeout(done, 100))
      }
      await page.goto(url)
      const image = (slot) => page.locator(`img[src=${JSON.stringify(selection.brand.assets[slot])}]`).first()
      if (!authenticated) {
        await page.getByRole('button', { name: '登录', exact: true }).waitFor({ timeout: 30000 })
        await image('login').waitFor()
        await page.getByText(selection.brand.copyright, { exact: true }).waitFor()
        if (screenshots) await page.screenshot({ path: join(screenshots, '品牌配置-登录页.png') })
      } else {
        await page.getByText('专业智能助手', { exact: true }).waitFor({ timeout: 30000 })
        await image('sidebar').waitFor()
        await image('home').waitFor()
        await image('avatar').waitFor()
        await page.waitForFunction(() => [...document.images].every(img => img.complete && img.naturalWidth > 0))
        if (screenshots) await page.screenshot({ path: join(screenshots, '品牌配置-首页.png') })
        await page.getByRole('button', { name: '本地开发', exact: true }).click()
        await page.getByText('785.83', { exact: true }).waitFor()
        await image('credits').waitFor()
        if (screenshots) await page.screenshot({ path: join(screenshots, '品牌配置-用户菜单.png') })
      }
      assert.deepEqual(errors, [], 'Product browser errors')
      child.stdin.write('wanwei-update-shutdown\n')
      await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('Sidecar shutdown timeout')), 30000))])
      assert.equal(child.exitCode, 0)
    } finally {
      await page.close()
      if (child.exitCode === null) { child.kill(); await Promise.race([exited, new Promise(done => setTimeout(done, 3000))]) }
      await rm(home, { recursive: true, force: true })
    }
  }
  console.log('Real product composition: login, copyright, independent sidebar/home/avatar and credits assets passed.')
} finally { await browser.close(); backend.close() }
