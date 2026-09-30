/** Keyless smoke of the actual desktop Loader profile and browser language pack. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ensureProductProfile } from '../../../../products/wanwei-desktop/scripts/product-profile.mjs'

const root = resolve(import.meta.dirname, '../../../..')
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('playwright')

for (const enabled of [true, false]) {
  const home = await mkdtemp(join(tmpdir(), 'wanwei-chinese-smoke-'))
  ensureProductProfile(home)
  if (!enabled) await writeFile(join(home, 'profiles/wanwei-desktop/cordis.patch.yml'),
    '- id: wanwei-chinese\n  disabled: true\n')
  const child = spawn(process.execPath, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts',
    '--profile', 'wanwei-desktop', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DSH_HOME: home, DSH_DESKTOP_DEVELOPMENT: '1',
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
    const context = await browser.newContext({ locale: 'zh-CN' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(match[0])
    await page.getByText('专业智能助手', { exact: true }).waitFor({ timeout: 30000 })
    const graph = await page.evaluate(() => window.__DSH_BOOT__)
    assert.equal(graph.entries.some(entry => entry.id === '@deepseek-ai/dsh-wanwei-chinese'), enabled)
    assert.ok(!(await page.locator('body').innerText()).includes('Failed to load plugins'))
    assert.equal(errors.length, 0, errors.join('\n'))
    console.log(`Chinese plugin ${enabled ? 'enabled' : 'disabled'}: desktop booted without plugin errors`)
  } finally {
    await browser?.close()
    child.kill()
    await Promise.race([exited, new Promise(done => setTimeout(done, 3000))])
    assert.ok(home.startsWith(join(tmpdir(), 'wanwei-chinese-smoke-')))
    await rm(home, { recursive: true, force: true })
  }
}
