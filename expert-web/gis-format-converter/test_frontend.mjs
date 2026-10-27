import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const app = readFileSync(join(root, 'web/app.js'), 'utf8')
const html = readFileSync(join(root, 'web/index.html'), 'utf8')
const css = readFileSync(join(root, 'web/style.css'), 'utf8')

test('workbench exposes only this expert tool', () => {
  assert.match(html, /<title>GIS 格式转换<\/title>/)
  assert.match(app, /id: 'format-convert'/)
  assert.doesNotMatch(app, /id: 'coordinate-transform'/)
  assert.doesNotMatch(app, /id: 'redline-extract'/)
  assert.match(app, /save_expert_artifact/)
})

test('active tasks show progress UI', () => {
  assert.match(app, /progressMarkup/)
  assert.match(app, /task-progress/)
  assert.match(app, /estimatedProgress/)
  assert.match(app, /已用时/)
  assert.match(app, /task\.state === 'queued'\) return 0/)
  assert.match(app, /if \(elapsed <= 0\) return 0/)
})

test('progress bars default to empty width instead of block 100%', () => {
  assert.match(css, /\.task-progress-bar\{[^}]*width:0/)
  assert.match(css, /\.history-progress>span\{[^}]*width:0/)
})

test('result page can preview outputs', () => {
  assert.match(app, /loadResultPreviews/)
  assert.match(app, /成果预览/)
})

test('solo home uses full-width feature panel', () => {
  assert.match(app, /conversion-feature/)
  assert.match(app, /conversion-feature-body/)
  assert.match(app, /conversion-format-chips/)
  assert.match(app, /\.gdb/)
  assert.doesNotMatch(app, /conversion-tools/)
})
