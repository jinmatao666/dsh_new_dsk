import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const html = readFileSync(fileURLToPath(new URL('index.html', import.meta.url)), 'utf8');
test('standalone page has no network, uploads, task APIs or privileged bridge', () => {
  assert.match(html, /敬请期待/);
  assert.match(html, /此专家暂未开放/);
  assert.doesNotMatch(html, /(?:src|href)=["']https?:|fetch\(|<iframe|<form|<input|__ZJUGIS_NATIVE_INVOKE__/i);
});
test('launch fragments are discarded without redeeming or persisting a ticket', () => {
  assert.match(html, /history\.replaceState\(null,'',location\.pathname\+location\.search\)/);
  assert.doesNotMatch(html, /localStorage|sessionStorage|\/redeem|\/usage/);
});
test('message is accessible and mobile layout is declared', () => {
  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /aria-labelledby="title"/);
  assert.match(html, /@media\(max-width:600px\)/);
});
test('Nginx CSP authorizes only the exact shipped inline script and style', () => {
  const config = readFileSync(fileURLToPath(new URL('nginx.location.conf.example', import.meta.url)), 'utf8');
  for (const tag of ['script', 'style']) {
    const source = html.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))[1];
    const hash = createHash('sha256').update(source).digest('base64');
    assert.ok(config.includes(`'sha256-${hash}'`));
  }
  assert.doesNotMatch(config, /unsafe-inline|unsafe-eval/);
});
test('header embeds the exact approved brand asset path, not a redrawn logo', () => {
  const asset = readFileSync(fileURLToPath(new URL('assets/brand-mark.svg', import.meta.url)), 'utf8');
  const normalize = value => value.replace(/\s+/g, '');
  const original = asset.match(/\bd="([^"]+)"/)[1];
  const embedded = html.match(/<header>[\s\S]*?\bd="([^"]+)"/)[1];
  assert.equal(normalize(embedded), normalize(original));
  assert.match(html, /fill="#2F6FC4"/);
});
