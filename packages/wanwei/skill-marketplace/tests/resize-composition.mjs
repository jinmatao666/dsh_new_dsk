/** Keyless desktop-profile regression for resizing without leaving capability panels. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { ensureProductProfile } from '../../../../products/wanwei-desktop/scripts/product-profile.mjs'

const root = resolve(import.meta.dirname, '../../../..')
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('playwright')
const home = await mkdtemp(join(tmpdir(), 'wanwei-resize-smoke-'))
ensureProductProfile(home)
const featureIds = { 技能市场: 'wanwei-skill-marketplace', 专家库: 'wanwei-expert-library',
  连接器: 'wanwei-connectors', 自动化: 'wanwei-automations' }
const disabled = process.argv.find(argument => argument.startsWith('--disable='))?.slice('--disable='.length)
const network = process.argv.includes('--intranet') ? 'intranet' : 'internet'
if (disabled) {
  assert.ok(Object.values(featureIds).includes(disabled))
  await writeFile(join(home, 'profiles/wanwei-desktop/cordis.patch.yml'), `- id: ${disabled}\n  disabled: true\n`)
}
// Server-owned policy must be deterministic; never depend on a developer's live backend.
const backend = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json')
  const data = request.url === '/api/desktop-config'
    ? { network, operator: 'fixture', phone: '' } : []
  response.end(JSON.stringify({ success: true, data }))
})
await new Promise(done => backend.listen(0, '127.0.0.1', done))
const backendOrigin = `http://127.0.0.1:${backend.address().port}`
const child = spawn(process.execPath, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts',
  '--profile', 'wanwei-desktop', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DSH_HOME: home, DSH_DESKTOP_DEVELOPMENT: '1',
    DSH_ONEAPI_URL: backendOrigin,
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
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(output)
    await new Promise(done => setTimeout(done, 100))
  }
  browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(match[0])
  await page.getByText('专业智能助手', { exact: true }).waitFor({ timeout: 30000 })
  if (network === 'intranet') {
    await page.locator('.dsh-skill-market-action').filter({ hasText: '自动化' })
      .locator('small').getByText('不可用', { exact: true }).waitFor({ timeout: 30000 })
  }
  const hidden = Object.entries(featureIds).filter(([name, id]) =>
    id === disabled || (network === 'intranet' && name === '连接器'))
  assert.equal(await page.locator('.dsh-skill-market-action').count(), 4 - hidden.length)
  for (const [name, id] of Object.entries(featureIds)) {
    if (hidden.some(([, hiddenId]) => hiddenId === id)) {
      assert.equal(await page.locator('.dsh-skill-market-action').filter({ hasText: name }).count(), 0)
      continue
    }
    const action = page.locator('.dsh-skill-market-action').filter({ hasText: name })
    if (network === 'intranet' && ['专家库', '自动化'].includes(name)) {
      assert.equal(await action.isDisabled(), true, `${name}: intranet entry remains disabled`)
      assert.equal(await action.getAttribute('title'), '纯内网环境不可用')
      assert.equal(await action.locator('small').textContent(), '不可用')
      await action.evaluate(button => button.click())
      assert.equal(await page.getByRole('dialog', { name, exact: true }).count(), 0)
      console.log(`${name}: intranet entry disabled; no page opens`)
      continue
    }
    await page.locator('.dsh-skill-market-action').filter({ hasText: name }).click()
    const panel = page.locator('.dsh-skill-market-panel:visible')
    await panel.waitFor()
    assert.equal(await page.locator('.dsh-skill-market-panel:visible').count(), 1)
    const originalPanel = await panel.elementHandle()
    const filter = panel.locator('input[type="search"], input[type="text"]').first()
    const hasFilter = await filter.count() > 0
    if (hasFilter) await filter.fill('PDF')
    const handle = page.locator('[data-side="sidebar"]')
    const before = await handle.boundingBox()
    assert.ok(before)
    // The capability overlay starts at the column border; grab the sidebar half
    // of the straddling handle so the overlay cannot intercept the pointer.
    await page.mouse.move(before.x + 1, before.y + 250)
    await page.mouse.down()
    await page.mouse.move(before.x + 25, before.y + 250, { steps: 6 })
    await page.mouse.up()
    await panel.waitFor({ state: 'visible' })
    assert.ok(await originalPanel.evaluate(element => element.isConnected), `${name}: panel remounted`)
    await page.waitForFunction(x => document.querySelector('[data-side="sidebar"]').getBoundingClientRect().x > x + 10,
      before.x, { timeout: 5000 })
    if (hasFilter) assert.equal(await filter.inputValue(), 'PDF', `${name}: filter reset`)
    console.log(`${name}: resizing preserves the active panel and filter`)
  }
  if (process.argv.includes('--screenshot')) {
    await page.screenshot({ path: join(tmpdir(), 'wanwei-independent-plugins.png') })
  }
  await page.getByRole('button', { name: '新建会话', exact: true }).first().click()
  assert.equal(await page.locator('.dsh-skill-market-panel:visible').count(), 0)
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log('Sidebar navigation still closes the capability panel')
  if (disabled) console.log(`${disabled}: independently disabled; other three remain usable`)
} finally {
  await browser?.close()
  backend.closeAllConnections()
  await new Promise(done => backend.close(done))
  child.kill()
  await Promise.race([exited, new Promise(done => setTimeout(done, 3000))])
  assert.ok(home.startsWith(join(tmpdir(), 'wanwei-resize-smoke-')))
  await rm(home, { recursive: true, force: true })
}
