/** Exercise the product profile's real authenticated SkillHub RPC against the public upstream. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { ensureProductProfile } from './product-profile.mjs'

const root = resolve(import.meta.dirname, '../../..')
const home = await mkdtemp(join(tmpdir(), 'wanwei-skillhub-composition-'))
ensureProductProfile(home)
const child = spawn(process.execPath, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'wanwei-desktop', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
  cwd: root, env: { ...process.env, DSH_HOME: home, DSH_DESKTOP_DEVELOPMENT: '1', DSH_BUNDLE_ANCHORS: join(root, 'products/wanwei-desktop/package.json') }, stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.on('data', chunk => { output += chunk.toString() })
child.stderr.on('data', chunk => { output += chunk.toString() })
const exited = new Promise(resolveExit => child.once('exit', resolveExit))
try {
  const deadline = Date.now() + 180000
  let match
  while (!(match = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/))) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error('Product profile did not become ready')
    await new Promise(resolveWait => setTimeout(resolveWait, 200))
  }
  const start = new URL(match[0])
  const login = await fetch(start, { redirect: 'manual' })
  assert.equal(login.status, 303)
  const cookie = login.headers.getSetCookie().map(item => item.split(';')[0]).join('; ')
  const rpc = async (operation, payload, authenticated = true) => {
    const response = await fetch(new URL(`/wanwei-skillhub/${operation}`, start), {
      method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { cookie } : {}) },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: operation, payload }),
      signal: AbortSignal.timeout(60000),
    })
    if (!authenticated) { assert.equal(response.status, 401); return }
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.result.ok, true, body.result.error?.message)
    return body.result.value
  }
  await rpc('list', {}, false)
  const page = await rpc('list', { keyword: 'find-skill-skillhub', page: 1 })
  assert.ok(page.items.length > 0)
  const detail = await rpc('detail', { slug: 'find-skill-skillhub' })
  const bundle = await rpc('download', { slug: detail.slug, version: detail.version })
  const bytes = Buffer.from(bundle.archive, 'base64')
  assert.equal(createHash('sha256').update(bytes).digest('hex'), bundle.sha256)
  assert.equal(bytes.subarray(0, 2).toString(), 'PK')
  const archiveArg = process.argv.indexOf('--archive')
  if (archiveArg >= 0) await writeFile(resolve(process.argv[archiveArg + 1]), bytes)
  // The remote page never writes a skill into the user's or test product's home.
  await assert.rejects(readFile(join(home, 'skills', detail.slug, 'SKILL.md')), { code: 'ENOENT' })
  console.log(`SkillHub composition passed: authenticated list/detail/download, ${bytes.length} ZIP bytes, pinned version ${detail.version}.`)
  const screenshotArg = process.argv.indexOf('--screenshot')
  if (screenshotArg >= 0) {
    const { chromium } = createRequire(join(root, 'apps/web/package.json'))('playwright')
    const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      await page.addInitScript(() => {
        const invoke = async command => {
          if (command.startsWith('list_')) return []
          if (command === 'set_auth_window_state') return null
          throw new Error('Native mutations are tested by Rust, not the browser preview')
        }
        window.__ZJUGIS_NATIVE_INVOKE__ = invoke
        window.__TAURI__ = { core: { invoke } }
      })
      // Keep the platform reference stable; SkillHub still uses the live product RPC.
      await page.route('**/desktop-auth/skill-list', async route => {
        const body = route.request().postDataJSON()
        await route.fulfill({ json: { type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { items: [{ id: 9001, name: 'platform-reference', display_name: '平台参考技能', description: '平台功能回归检查', version: '1.0', category: '通用' }] } } } })
      })
      page.on('pageerror', error => console.error('Browser error:', error.message))
      await page.goto(start.href)
      try {
        await page.getByRole('button', { name: '技能市场', exact: true }).click({ timeout: 30000 })
      } catch (error) {
        await page.screenshot({ path: resolve(process.argv[screenshotArg + 1]) })
        console.error('Rendered page:', (await page.locator('body').innerText()).slice(0, 2400))
        throw error
      }
      await page.getByRole('heading', { name: '平台技能', exact: true }).waitFor()
      const hub = page.locator('.wanwei-skillhub')
      await hub.getByRole('button', { name: '查看详情' }).first().waitFor({ timeout: 60000 })
      assert.equal(await hub.evaluate(element => {
        const parent = element.parentElement
        return parent === document.querySelector('.dsh-skill-featured-section')?.parentElement
          && parent === document.querySelector('.dsh-skill-all-section')?.parentElement
      }), true, 'Recommendations, platform skills and SkillHub must be sibling sections')
      assert.equal(await page.locator('.dsh-skill-featured-section').getByText('来自腾讯 SkillHub').count(), 0)
      assert.equal(await page.locator('.dsh-skill-featured-section').getByText('平台参考技能').count(), 1)
      await page.addStyleTag({ content: '.wanwei-skillhub *, .dsh-skill-card { animation: none !important; transition: none !important; }' })
      await hub.scrollIntoViewIfNeeded()
      await page.screenshot({ path: resolve(process.argv[screenshotArg + 1]) })
      await hub.getByLabel('搜索 SkillHub 技能').fill('find-skill-skillhub')
      await hub.getByRole('button', { name: '搜索', exact: true }).click()
      await hub.getByRole('button', { name: '查看详情' }).first().click({ timeout: 60000 })
      await hub.getByRole('button', { name: '安装', exact: true }).waitFor({ timeout: 60000 })
      assert.equal(await hub.getByRole('button', { name: '安装', exact: true }).isEnabled(), true)
      await hub.getByRole('button', { name: '返回 SkillHub 列表' }).click()
      assert.equal(await hub.getByLabel('搜索 SkillHub 技能').inputValue(), 'find-skill-skillhub')
      await page.setViewportSize({ width: 760, height: 900 })
      const overflow = await hub.evaluate(element => element.scrollWidth > element.clientWidth + 1)
      assert.equal(overflow, false, 'SkillHub section must not overflow horizontally')
      console.log('Browser verification passed: platform recommendations, live search/detail/back and narrow layout. Native mutations mocked in browser only.')
    } finally { await browser.close() }
  }
} finally {
  child.kill()
  await Promise.race([exited, new Promise(resolveWait => setTimeout(resolveWait, 5000))])
  assert.ok(home.startsWith(join(tmpdir(), 'wanwei-skillhub-composition-')))
  await rm(home, { recursive: true, force: true })
}
