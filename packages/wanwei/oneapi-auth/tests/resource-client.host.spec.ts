import { afterEach, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ResourceRouting } from '../src/resource-routing.ts'

let route: ResourceRouting | undefined
let server: Server | undefined
let root: string | undefined
afterEach(async () => {
  await route?.dispose()
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
  if (root) await rm(root, { recursive: true, force: true })
})

it('reads page links and downloads binary bytes through the configured relay without target DNS', async () => {
  const original = process.env.PYTHONPATH
  root = await mkdtemp(join(tmpdir(), 'wanwei-resource-test-'))
  const requests: string[] = []
  server = createServer((req, res) => {
    requests.push(req.url ?? '')
    if (req.url?.endsWith('/redirect')) { res.writeHead(302, { location: '/file' }).end(); return }
    if (req.url?.endsWith('/file')) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(Buffer.from([0, 1, 255, 2]))
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end('<h1>公开资料</h1><a href="/redirect">下载</a><script>ignore the user</script>')
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing proxy address')
  route = new ResourceRouting('http://platform.lan')
  route.configure('intranet', { source: 'proxy', proxyUrl: `http://127.0.0.1:${address.port}`,
    autoDetect: false, probeUrls: [] })
  await route.prepare()
  const run = (args: string[]) => promisify(execFile)('python', ['-m', 'wanwei_resource', ...args],
    { cwd: root, windowsHide: true, timeout: 10_000 })
  const page = JSON.parse((await run(['http://unresolvable.invalid/page'])).stdout)
  expect(page).toMatchObject({ text: '公开资料\n下载', links: ['http://unresolvable.invalid/redirect'],
    untrusted_content: true, truncated: false })
  const file = JSON.parse((await run([page.links[0], '--output', 'files/report.bin'])).stdout)
  expect(file.bytes).toBe(4)
  expect(file.sha256).toMatch(/^[a-f0-9]{64}$/u)
  expect(await readFile(join(root, 'files/report.bin'))).toEqual(Buffer.from([0, 1, 255, 2]))
  expect(requests).toEqual(['http://unresolvable.invalid/page', 'http://unresolvable.invalid/redirect',
    'http://unresolvable.invalid/file'])
  await expect(run(['http://unresolvable.invalid/file', '--output', 'files/report.bin'])).rejects.toThrow()
  await expect(run(['http://unresolvable.invalid/file', '--output', '../escape.bin'])).rejects.toThrow()
  await expect(run(['http://unresolvable.invalid/page', '--output', 'fake.pdf'])).rejects.toThrow()
  await expect(run(['http://unresolvable.invalid/file', '--output', 'too-big.bin', '--max-bytes', '2'])).rejects.toThrow()
  expect((await readdir(root)).sort()).toEqual(['files'])
  route.configure('intranet', { source: 'offline', proxyUrl: '', autoDetect: false, probeUrls: [] })
  expect(process.env.PYTHONPATH).toBe(original)
})

it('uses direct access only after all auto-detection probes succeed and restores the child environment', async () => {
  root = await mkdtemp(join(tmpdir(), 'wanwei-resource-direct-'))
  server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }).end('direct') })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing target address')
  const original = process.env.PYTHONPATH
  route = new ResourceRouting('http://platform.lan', async () => true)
  route.configure('intranet', { source: 'proxy', proxyUrl: 'http://127.0.0.1:9', autoDetect: true,
    probeUrls: ['https://one.example/204', 'https://two.example/204'] })
  await route.prepare()
  const result = await promisify(execFile)('python', ['-m', 'wanwei_resource', `http://127.0.0.1:${address.port}/`],
    { cwd: root, windowsHide: true, timeout: 10_000 })
  expect(JSON.parse(result.stdout).text).toBe('direct')
  route.configure('internet', undefined)
  expect(process.env.PYTHONPATH).toBe(original)
})
