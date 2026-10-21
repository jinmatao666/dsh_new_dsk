/** Real desktop profile regression; only the backend and native OS bridge are fixtures. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { ensureProductProfile } from '../../../../products/wanwei-desktop/scripts/product-profile.mjs'

const root = resolve(import.meta.dirname, '../../../..')
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('playwright')
const home = await mkdtemp(join(tmpdir(), 'wanwei-skill-reference-'))
ensureProductProfile(home)
const workspace = join(home, 'workspace')
await mkdir(workspace)
const slug = 'office-excel-data-cleaner'
await mkdir(join(home, 'skills', slug), { recursive: true })
await writeFile(join(home, 'skills', slug, 'SKILL.md'), `---\nname: ${slug}\ndisplay-name: Excel 数据处理\ndescription: 清理表格\n---\n清理表格。\n`)
const skill = { id: 71, name: slug, display_name: 'Excel 数据处理', description: '清理 Excel 台账，完成去重和筛选。',
  scenario: '保留原始文件，生成清理后的 Excel。', usage_example: '请清理工作区中的客户台账，删除重复行。\n保留原文件，输出清理后的 Excel。',
  version: '1.0.0', source: 'official', category: '办公工具', icon: 'preset:analytics', downloads: 3 }
const backend = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json')
  if (request.url?.startsWith('/api/skill/?')) {
    response.end(JSON.stringify({ success: true, items: [skill], total: 1 })); return
  }
  const data = request.url === '/api/desktop-config' ? { network: 'internet', operator: 'fixture', phone: '' } : []
  response.end(JSON.stringify({ success: true, data }))
})
await new Promise(done => backend.listen(0, '127.0.0.1', done))
const child = spawn(process.execPath, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts',
  '--profile', 'wanwei-desktop', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DSH_HOME: home, DSH_DESKTOP_DEVELOPMENT: '1',
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
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(output)
    await new Promise(done => setTimeout(done, 100))
  }
  browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1200, height: 850 } })
  await page.addInitScript(({ slug, workspace }) => {
    window.__TAURI_INTERNALS__ = { invoke: async (command) => {
      if (command === 'list_marketplace_skills') return [{ id: 'remote-71', slug, version: '1.0.0', installedVersion: '1.0.0', state: 'installed' }]
      if (command === 'list_custom_skills') return []
      if (command === 'create_automatic_workspace') return workspace
      return null
    } }
  }, { slug, workspace })
  await page.goto(match[0])
  await page.getByText('专业智能助手', { exact: true }).waitFor({ timeout: 30000 })
  assert.equal(await page.getByRole('combobox', { name: '选择技能', exact: true }).count(), 0)
  await page.locator('.dsh-skill-market-action').filter({ hasText: '技能市场' }).click()
  await page.getByText('Excel 数据处理', { exact: true }).first().click()
  await page.getByRole('heading', { name: '使用示例', exact: true }).waitFor()
  assert.equal(await page.locator('.dsh-skill-usage-examples p').textContent(), skill.usage_example)
  await page.screenshot({ path: join(tmpdir(), 'wanwei-skill-detail-examples.png') })
  await page.getByRole('button', { name: '使用技能', exact: true }).click()
  const staged = page.locator('.dsh-skill-draft-prefix')
  await staged.waitFor()
  const capsuleBox = await staged.boundingBox()
  const removeBox = await staged.locator('.dsh-skill-draft-remove').boundingBox()
  assert.ok(capsuleBox && removeBox && removeBox.y < capsuleBox.y
    && removeBox.x + removeBox.width > capsuleBox.x + capsuleBox.width,
  'The removal control stays at the upper-right corner, outside the capsule text.')
  assert.equal(await page.getByRole('combobox', { name: '选择技能', exact: true }).count(), 0)
  await page.locator('[data-composer-input]:visible').fill('仅清理客户台账，不修改原文件。')
  await staged.locator('.dsh-skill-draft-open').click()
  await page.getByRole('heading', { name: '使用示例', exact: true }).waitFor()
  await page.locator('.dsh-skill-market-action').filter({ hasText: '技能市场' }).click()
  await staged.waitFor()
  assert.ok((await page.locator('[data-composer-input]:visible').textContent()).includes('仅清理客户台账'))
  await page.screenshot({ path: join(tmpdir(), 'wanwei-skill-reference-staged.png') })
  await staged.locator('.dsh-skill-draft-remove').click()
  assert.equal(await staged.count(), 0)
  assert.ok((await page.locator('[data-composer-input]:visible').textContent()).includes('仅清理客户台账'))
  console.log('Desktop profile: usage examples, staged detail navigation and reference-only removal passed.')
} finally {
  await browser?.close()
  backend.closeAllConnections()
  await new Promise(done => backend.close(done))
  child.kill()
  await Promise.race([exited, new Promise(done => setTimeout(done, 3000))])
  assert.ok(home.startsWith(join(tmpdir(), 'wanwei-skill-reference-')))
  await rm(home, { recursive: true, force: true })
}
