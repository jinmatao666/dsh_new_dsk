import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stageWebAssets } from './stage-web-assets.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'wanwei-web-assets-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'product-assets')
  const dist = join(root, 'web-dist')
  mkdirSync(join(source, 'knowledge-covers'), { recursive: true })
  for (const name of ['icon-library-header.png', 'plaza-entry.png', 'icon-plaza-launch-arrow.png']) {
    writeFileSync(join(source, 'knowledge-covers', name), `image:${name}`)
  }
  writeFileSync(join(source, 'brand-mark.svg'), '<svg/>')
  return { source, dist }
}

test('restores product icons after an official Web build without replacing the compiled page', (t) => {
  const { source, dist } = fixture(t)
  mkdirSync(dist)
  writeFileSync(join(dist, 'index.html'), '<html>compiled app</html>')
  stageWebAssets(source, dist)
  assert.equal(readFileSync(join(dist, 'index.html'), 'utf8'), '<html>compiled app</html>')
  assert.equal(readFileSync(join(dist, 'brand-mark.svg'), 'utf8'), '<svg/>')
  for (const name of ['icon-library-header.png', 'plaza-entry.png', 'icon-plaza-launch-arrow.png']) {
    assert.deepEqual(readFileSync(join(dist, 'knowledge-covers', name)), readFileSync(join(source, 'knowledge-covers', name)))
  }
})

test('repeated startup refreshes stale artwork without nesting asset directories', (t) => {
  const { source, dist } = fixture(t)
  stageWebAssets(source, dist)
  writeFileSync(join(source, 'knowledge-covers/plaza-entry.png'), 'updated image')
  stageWebAssets(source, dist)
  assert.equal(readFileSync(join(dist, 'knowledge-covers/plaza-entry.png'), 'utf8'), 'updated image')
  assert.equal(existsSync(join(dist, 'product-assets')), false)
  assert.equal(existsSync(join(dist, 'knowledge-covers/knowledge-covers')), false)
})

test('missing product assets fail before creating output', (t) => {
  const { source, dist } = fixture(t)
  assert.throws(() => stageWebAssets(join(source, 'missing'), dist), { code: 'ENOENT' })
  assert.equal(existsSync(dist), false)
})
