/** Local browser smoke of built assets with mock API responses; no live services. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const build = fileURLToPath(new URL('../web/build/air/', import.meta.url));
const index = await readFile(resolve(build, 'index.html'), 'utf8');
let admin = '', api = '';
const requests = [], failures = [];
const contentTypes = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    requests.push(pathname);
    if (pathname.startsWith(api + '/api/')) {
      const route = pathname.slice(api.length);
      const user = { id: 1, username: 'smoke', display_name: 'Smoke', role: 100, status: 1 };
      const data = route === '/api/user/login' ? user
        : route === '/api/about' ? 'Runtime deployment browser smoke'
        : route === '/api/status' ? { system_name: 'Smoke', password_login_enabled: true, deployment_mode: 'public' }
        : route === '/api/user/dashboard' ? {} : [];
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, data }));
      return;
    }
    if (admin && !pathname.startsWith(admin + '/')) { res.writeHead(404).end(); return; }
    const relative = pathname.slice(admin.length).replace(/^\//, '');
    const file = resolve(build, relative);
    if (file !== resolve(build) && !file.startsWith(resolve(build) + sep)) { res.writeHead(404).end(); return; }
    if (extname(file) && await stat(file).then(s => s.isFile(), () => false)) {
      res.setHeader('Content-Type', contentTypes[extname(file)] || 'application/octet-stream');
      res.end(await readFile(file));
      return;
    }
    if (extname(relative)) { res.writeHead(404).end(); return; }
    const settings = JSON.stringify({ adminPrefix: admin, apiPrefix: api });
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-store');
    res.end(index.replace('<head>', `<head><base href="${admin}/"><script>window.__DSH_DEPLOYMENT__=${settings};</script>`));
  } catch (error) { failures.push(String(error)); res.writeHead(500).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.DSH_SMOKE_BROWSER ? { executablePath: process.env.DSH_SMOKE_BROWSER } : {}) });
  for (const prefixes of [['', ''], ['/dsh-admin', '/dsh-api'], ['/unit/control', '/unit/service']]) {
    [admin, api] = prefixes;
    requests.length = 0;
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', error => failures.push(String(error)));
    page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
    await page.goto(origin + admin + '/login');
    await page.getByPlaceholder('用户名', { exact: true }).fill('smoke');
    await page.getByPlaceholder('密码', { exact: true }).fill('smoke-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(url => url.pathname === (admin || '/') || url.pathname === admin + '/');
    await page.goto(origin + admin + '/about');
    await page.getByText('Runtime deployment browser smoke', { exact: true }).waitFor();
    await page.reload();
    await page.getByText('Runtime deployment browser smoke', { exact: true }).waitFor();
    await page.locator('.zjugis-user-chip').click();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await page.waitForURL(origin + admin + '/login');
    assert(requests.includes(api + '/api/user/login'));
    assert(requests.includes(api + '/api/user/logout'));
    assert(requests.includes(admin + '/brand-wordmark.svg'));
    assert(requests.some(path => path.startsWith(admin + '/static/js/') && path.includes('.chunk.js')), 'lazy chunk was not loaded');
    const wrong = requests.filter(path => !path.startsWith(admin + '/') && !path.startsWith(api + '/api/'));
    assert.deepEqual(wrong, []);
    assert.deepEqual(failures, []);
    console.log(`Built frontend passed login/logout, deep-link reload, lazy scripts, CSS and icons: ${admin || '/'} + ${api || '/'}`);
    await context.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
