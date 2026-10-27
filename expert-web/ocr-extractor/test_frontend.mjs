import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(root, 'web/index.html'), 'utf8');
const js = readFileSync(resolve(root, 'web/app.js'), 'utf8');
test('static assets and selector IDs exist', () => {
  for (const [, name] of html.matchAll(/(?:src|href)="(assets\/[^"#]+|style\.css|app\.js)"/g)) assert.ok(existsSync(resolve(root, 'web', name)), name);
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const [, id] of js.matchAll(/\$\('#([\w-]+)'\)/g)) assert.ok(ids.includes(id), id);
});
test('API and download URLs remain relative to expert prefix', () => {
  assert.doesNotMatch(js, /fetch\(['"]\//);
  assert.doesNotMatch(html, /(?:src|href)="\//);
  assert.match(js, /history\.replaceState/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|EXPERT_MODEL_KEY|EXPERT_PROVIDER_CREDENTIAL/);
});
test('model text is rendered as plain text and sample cannot be downloaded', () => {
  assert.match(js, /\$\('#result-content'\)\.textContent = resultText/);
  assert.match(js, /示例不是实际识别结果/);
  assert.match(js, /不进入任务历史或成果文件/);
  assert.match(js, /revision !== selection/);
  assert.match(js, /controllers\.forEach\(controller => controller\.abort\(\)\)/);
});
