import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, test } from 'node:test'
import { createApp } from './server.mjs'

let server
let base
const consumed = new Set()

before(async () => {
  server = createApp({ redeem: async ticket => {
    if (consumed.has(ticket)) return null
    consumed.add(ticket)
    return { user_id: ticket.startsWith('alice') ? 'alice' : 'bob' }
  } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => { await new Promise(resolve => server.close(resolve)) })

async function login(ticket) {
  const response = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket }) })
  return { response, cookie: response.headers.get('set-cookie')?.split(';')[0] }
}

test('one ticket creates one session and cannot be replayed', async () => {
  const first = await login('alice-ticket-unique-001')
  assert.equal(first.response.status, 200)
  assert.match(first.cookie, /^expert_smoke_session=[a-f0-9]{64}$/)
  const replay = await login('alice-ticket-unique-001')
  assert.equal(replay.response.status, 401)
  const unauthenticated = await fetch(`${base}/api/tasks`)
  assert.equal(unauthenticated.status, 401)
})

test('file task produces a real report visible only to its user', async () => {
  const alice = await login('alice-ticket-unique-002')
  const bob = await login('bob-ticket-unique-003')
  const content = Buffer.from('项目名称\n第一项\n第二项', 'utf8')
  const created = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: alice.cookie }, body: JSON.stringify({ name: '检查.txt', content: content.toString('base64') }) })
  assert.equal(created.status, 201)
  const { item } = await created.json()
  assert.equal(item.lines, 3)
  assert.equal(item.sha256, createHash('sha256').update(content).digest('hex'))
  const aliceList = await fetch(`${base}/api/tasks`, { headers: { cookie: alice.cookie } })
  assert.equal((await aliceList.json()).items.length, 1)
  const bobList = await fetch(`${base}/api/tasks`, { headers: { cookie: bob.cookie } })
  assert.deepEqual((await bobList.json()).items, [])
  const denied = await fetch(`${base}/api/tasks/${item.id}/report`, { headers: { cookie: bob.cookie } })
  assert.equal(denied.status, 404)
  const report = await fetch(`${base}/api/tasks/${item.id}/report`, { headers: { cookie: alice.cookie } })
  assert.equal(report.status, 200)
  assert.match(await report.text(), /行数：3/)
})

test('rejects invalid file data and serves only enumerated assets', async () => {
  const alice = await login('alice-ticket-unique-004')
  const invalid = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: alice.cookie }, body: JSON.stringify({ name: 'bad.txt', content: '%invalid%' }) })
  assert.equal(invalid.status, 400)
  const missing = await fetch(`${base}/../../server.mjs`)
  assert.equal(missing.status, 404)
  const page = await fetch(`${base}/`)
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.match(page.headers.get('content-security-policy'), /frame-src 'none'/)
})
