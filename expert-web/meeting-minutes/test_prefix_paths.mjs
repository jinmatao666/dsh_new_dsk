import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const prefix = 'http://ac.zjugis.com:3300/experts/example/'
const html = readFileSync(new URL('./web/index.html', import.meta.url), 'utf8')
const css = readFileSync(new URL('./web/style.css', import.meta.url), 'utf8')
const js = readFileSync(new URL('./web/app.js', import.meta.url), 'utf8')

test('static resources remain under an expert URL prefix', () => {
  for (const [, path] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    assert.equal(new URL(path, prefix).pathname.startsWith('/experts/example/'), true, path)
  }
  for (const [, path] of css.matchAll(/url\(['"]?([^'"\)]+)['"]?\)/g)) {
    assert.equal(new URL(path, `${prefix}style.css`).pathname.startsWith('/experts/example/'), true, path)
  }
  assert.doesNotMatch(js, /["'`]\/assets\//)
  assert.doesNotMatch(js, /(?:href|src)="\/api\//)
  assert.match(js, /fetch\(path\.startsWith\('\/api\/'\) \? path\.slice\(1\) : path, options\)/)
  assert.equal(new URL('api/tasks', prefix).pathname, '/experts/example/api/tasks')
})
