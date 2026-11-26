import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { loadBrand, brandText, stageBrandModules, moduleSource, prepareNativeBrand, stageWebBrand, productRoot } from './branding.mjs'

const example = join(productRoot, 'branding/example.json')

test('default brand preserves existing display text and stable slot URLs', () => {
  const { brand } = loadBrand(join(productRoot, 'branding/default.json'))
  assert.equal(brandText(brand, '万维 Buddy'), '万维 Buddy')
  assert.equal(brandText(brand, 'WANWEI Buddy'), 'WANWEI Buddy')
  assert.equal(brand.assets.avatar, '/brand-mark.svg')
  assert.equal(brand.assets.login, '/brand-wordmark.svg')
})

test('custom brand resolves relative assets, slot overrides and owned copy', () => {
  const { brand, sources } = loadBrand(example)
  assert.equal(brandText(brand, '问问万维'), '问问图谱')
  assert.equal(brandText(brand, '万维 Buddy · 定时任务'), '图谱助手 · 定时任务')
  assert.equal(brandText(brand, 'WANWEI Buddy'), 'Atlas Desk')
  assert.equal(brandText(brand, '请在万维 Buddy 桌面端打开专家'), '请在图谱助手桌面端打开专家')
  assert.equal(brand.assets.sidebar, '/brand-wordmark.svg')
  assert.equal(sources.sidebar, sources.login)
  assert.equal(sources.login, sources.home)
  assert.ok(!Object.hasOwn(brand, 'native'), 'machine paths must not enter public modules')
})

test('invalid brand fields and missing assets fail before compilation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brand-reject-'))
  try {
    const defaults = JSON.parse(readFileSync(join(productRoot, 'branding/default.json'), 'utf8'))
    for (const patch of [
      { schemaVersion: 2 }, { identifier: 'another.app' }, { windowTitle: 'bad\nname' },
      { assets: { wrongSlot: './x.svg' } }, { text: [] }, { text: { title: 42 } },
      { assets: { mark: './absent.svg' } }, { native: { wrong: './x.png' } },
      { name: 'Another brand' }, { sessionFilePrefix: '../escape' },
    ]) {
      const path = join(dir, 'invalid.json')
      writeFileSync(path, JSON.stringify({ ...defaults, ...patch }))
      assert.throws(() => loadBrand(path), JSON.stringify(patch))
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('generated templates restore byte for byte after a failed build', () => {
  const path = resolve(productRoot, '../../packages/wanwei/oneapi-auth/src/brand.generated.ts')
  const before = readFileSync(path)
  const { brand } = loadBrand(example)
  const restore = stageBrandModules(brand)
  try {
    assert.equal(readFileSync(path, 'utf8'), moduleSource(brand))
    throw new Error('simulated compiler failure')
  } catch (error) { assert.equal(error.message, 'simulated compiler failure') }
  finally { restore() }
  assert.deepEqual(readFileSync(path), before)
})

test('native staging and web assets do not change stable identity or source icons', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brand-stage-'))
  const icon = join(productRoot, 'src-tauri/icons/icon.ico')
  const original = readFileSync(icon)
  try {
    const selection = loadBrand(join(productRoot, 'branding/default.json'))
    const config = prepareNativeBrand(selection, { outputRoot: dir })
    assert.equal(config.productName, '万维Buddy')
    assert.ok(!Object.hasOwn(config, 'identifier'))
    assert.ok(!Object.hasOwn(config, 'plugins'))
    assert.match(readFileSync(join(dir, 'native.env'), 'utf8'), /DSH_PRODUCT_WINDOW_TITLE=万维Buddy/u)
    const custom = loadBrand(example)
    const publicRoot = join(dir, 'public')
    mkdirSync(publicRoot)
    stageWebBrand(custom, publicRoot)
    const wordmark = custom.composed.toString('utf8')
    assert.match(wordmark, /viewBox="0 0 2048 512"/u)
    assert.match(wordmark, /<image x="198" y="88" width="320" height="350"/u)
    assert.deepEqual(readFileSync(join(publicRoot, 'brand/avatar.svg')), readFileSync(custom.sources.avatar))
    assert.deepEqual(readFileSync(icon), original)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
