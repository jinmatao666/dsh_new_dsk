import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const projectDir = dirname(fileURLToPath(import.meta.url))
const maxBodyBytes = 8 * 1024 * 1024
const sessionDurationMs = 8 * 60 * 60 * 1000
const assetTypes = new Map([['/', 'text/html; charset=utf-8'], ['/style.css', 'text/css; charset=utf-8'], ['/app.js', 'text/javascript; charset=utf-8']])
const assetPaths = new Map([['/', 'index.html'], ['/style.css', 'style.css'], ['/app.js', 'app.js']])

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBodyBytes) throw Object.assign(new Error('文件超过 8 MB 上限'), { status: 413 })
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw Object.assign(new Error('请求不是有效 JSON'), { status: 400 }) }
}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  response.end(JSON.stringify(value))
}

function sessionId(request) {
  const match = /(?:^|;\s*)expert_smoke_session=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie ?? '')
  return match?.[1]
}

function titleFromText(text) {
  return text.split(/\r?\n/).map(line => line.trim()).find(Boolean)?.slice(0, 80) || '空文件'
}

/** Create the independent smoke site's HTTP server. The caller owns listen/close. */
export function createApp({ redeem, now = Date.now } = {}) {
  if (typeof redeem !== 'function') throw new Error('必须提供平台票据核验实现')
  const sessions = new Map()
  const tasks = new Map()
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (request.method === 'GET' && assetPaths.has(url.pathname)) {
        response.writeHead(200, { 'content-type': assetTypes.get(url.pathname), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'" })
        createReadStream(join(projectDir, assetPaths.get(url.pathname))).pipe(response)
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/session') {
        const body = await readJson(request)
        if (typeof body.ticket !== 'string' || body.ticket.length < 16 || body.ticket.length > 512) return json(response, 400, { error: '票据格式无效' })
        const identity = await redeem(body.ticket)
        if (!identity || typeof identity.user_id !== 'string' || identity.user_id.length === 0) return json(response, 401, { error: '票据核验失败' })
        const sid = randomBytes(32).toString('hex')
        sessions.set(sid, { userId: identity.user_id, expiresAt: now() + sessionDurationMs })
        const publicHTTPS = process.env.EXPERT_PUBLIC_URL?.startsWith('https://') === true
        response.setHeader('set-cookie', `expert_smoke_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${publicHTTPS || request.socket.encrypted ? '; Secure' : ''}`)
        return json(response, 200, { user_id: identity.user_id })
      }
      if (url.pathname.startsWith('/api/')) {
        const sid = sessionId(request)
        const session = sid && sessions.get(sid)
        if (!session || session.expiresAt <= now()) return json(response, 401, { error: '请重新打开专家工作台' })
        if (request.method === 'GET' && url.pathname === '/api/tasks') {
          return json(response, 200, { items: [...tasks.values()].filter(task => task.userId === session.userId).map(({ id, name, title, bytes, sha256, lines, createdAt }) => ({ id, name, title, bytes, sha256, lines, createdAt })) })
        }
        if (request.method === 'POST' && url.pathname === '/api/tasks') {
          const body = await readJson(request)
          if (typeof body.name !== 'string' || body.name.length === 0 || body.name.length > 180 || typeof body.content !== 'string') return json(response, 400, { error: '文件内容无效' })
          let data
          try {
            if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.content)) throw new Error('invalid base64')
            data = Buffer.from(body.content, 'base64')
          } catch { return json(response, 400, { error: '文件编码无效' }) }
          if (data.length > 5 * 1024 * 1024) return json(response, 413, { error: '文件超过 5 MB 上限' })
          const text = data.toString('utf8')
          if (Buffer.from(text, 'utf8').compare(data) !== 0) return json(response, 400, { error: '仅支持 UTF-8 文本文件' })
          const task = { id: randomBytes(12).toString('hex'), userId: session.userId, name: body.name, title: titleFromText(text), bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), lines: text === '' ? 0 : text.split(/\r?\n/).length, createdAt: new Date(now()).toISOString() }
          tasks.set(task.id, task)
          return json(response, 201, { item: task })
        }
        const reportMatch = /^\/api\/tasks\/([a-f0-9]{24})\/report$/.exec(url.pathname)
        if (request.method === 'GET' && reportMatch) {
          const task = tasks.get(reportMatch[1])
          if (!task || task.userId !== session.userId) return json(response, 404, { error: '未找到报告' })
          response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="report-${task.id}.txt"`, 'cache-control': 'no-store' })
          return response.end(`文件：${task.name}\n首行：${task.title}\n字节：${task.bytes}\n行数：${task.lines}\nSHA-256：${task.sha256}\n生成时间：${task.createdAt}\n`)
        }
        return json(response, 404, { error: '接口不存在' })
      }
      return json(response, 404, { error: '页面不存在' })
    } catch (error) {
      return json(response, error.status ?? 500, { error: error.status ? error.message : '服务暂时不可用' })
    }
  })
}

async function redeemWithPlatform(ticket) {
  const endpoint = process.env.EXPERT_PLATFORM_REDEEM_URL
  const credential = process.env.EXPERT_PROVIDER_CREDENTIAL
  if (!endpoint || !credential) throw new Error('未配置平台票据核验地址或提供方凭据')
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` }, body: JSON.stringify({ ticket }), signal: AbortSignal.timeout(10_000), redirect: 'error' })
  if (!response.ok) throw Object.assign(new Error('票据核验失败'), { status: 401 })
  return response.json()
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 4300)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是有效端口')
  createApp({ redeem: redeemWithPlatform }).listen(port, '127.0.0.1', () => process.stdout.write(`integration-smoke listening on 127.0.0.1:${port}\n`))
}
