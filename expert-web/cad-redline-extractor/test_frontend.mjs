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
  assert.match(html, /<title>红线提取<\/title>/)
  assert.match(app, /id: 'redline-extract'/)
  assert.doesNotMatch(app, /id: 'coordinate-transform'/)
  assert.doesNotMatch(app, /id: 'format-convert'/)
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

test('result page supports overlay visualization', () => {
  assert.match(app, /loadResultOverlay/)
  assert.match(app, /成果套合可视化/)
  assert.match(app, /\/api\/overlay\/parse/)
  assert.match(app, /\/api\/overlay\/online-map/)
  assert.match(app, /\/api\/map-config/)
  assert.match(app, /data-preview-geometry/)
  assert.match(app, /openGeometryModal/)
  assert.match(app, /添加在线服务/)
  assert.match(app, /overlay-service-token/)
  assert.doesNotMatch(app, /overlay-service-username/)
  assert.doesNotMatch(app, /overlay-service-password/)
  assert.match(app, /上传本地图层/)
  assert.match(app, /data-remove-local/)
  assert.match(app, /data-remove-online/)
  assert.match(app, /data-locate-local/)
  assert.match(app, /data-locate-online/)
  assert.match(app, /fitMapToDataBounds/)
  assert.match(app, /overlay-service-modal/)
  assert.match(app, /overlay-map/)
  assert.match(app, /ImageArcGISRest/)
  assert.match(app, /syncOverlayMap/)
  assert.match(app, /overlay-layer-control/)
  assert.match(app, /overlay-layers-toggle/)
  assert.match(app, /layerControlMarkup/)
  assert.match(app, /overlay-zoom-in/)
  assert.match(app, /applyMapZoom/)
  assert.doesNotMatch(app, /几何列表 · 单独展示/)
  assert.match(css, /\.overlay-panel\{/)
  assert.match(css, /#overlay-map\{/)
  assert.match(css, /\.overlay-layer-control\{/)
  assert.match(css, /\.overlay-layer-toggle\{/)
  assert.match(css, /\.overlay-zoom-control\{/)
  assert.match(css, /\.overlay-modal\{/)
  assert.match(css, /\.overlay-source-list\{/)
  assert.doesNotMatch(css, /\.overlay-legend\{/)
  assert.doesNotMatch(css, /\.overlay-layer-control \.legend-result::before/)
  const html = readFileSync(new URL('./web/index.html', import.meta.url), 'utf8')
  assert.match(html, /vendor\/ol\/ol\.js/)
  assert.match(html, /vendor\/ol\/ol\.css/)
})

test('solo home uses full-width feature panel', () => {
  assert.match(app, /conversion-feature/)
  assert.match(app, /conversion-feature-body/)
  assert.match(app, /conversion-format-chips/)
  assert.match(app, /\.dwg/)
  assert.doesNotMatch(app, /conversion-tools/)
})

test('history can delete terminal tasks', () => {
  assert.match(app, /data-delete/)
  assert.match(app, /\/api\/tasks\/\$\{node\.dataset\.delete\}\/delete/)
  assert.match(app, /删除此任务记录及其文件/)
  assert.match(css, /\.history-open\{/)
  assert.match(css, /\.history-row \.delete-task\{/)
})
