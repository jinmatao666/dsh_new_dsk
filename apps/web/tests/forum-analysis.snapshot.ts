/** Authenticated portal stream replay through the shipped Web composition. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { normalizeSessionSnapshots, formatSystemPromptSnapshot, formatToolSchemasSnapshot } from '@deepseek-ai/dsh-session-snapshot'
import { launchWebScaffold, webSnapshotMode } from './scaffold.ts'

const dir = fileURLToPath(new URL('../../../snapshots/web/forum-analysis', import.meta.url))

it('replays forum analysis using the desktop-selected model and the recorded article input', async () => {
  let fixture = await readFile(join(dir, 'session.jsonl'), 'utf8')
  const rows = fixture.trim().split('\n').map(line => JSON.parse(line) as { type: string; data: { content?: { type: string; text: string }[] } })
  const prompt = rows.find(row => row.type === 'user/message')?.data.content?.find(block => block.type === 'text')?.text
  if (!prompt) throw new Error('forum recording has no question')
  const input: unknown = JSON.parse(prompt)
  if (!input || typeof input !== 'object') throw new Error('forum recording has invalid input')
  const scaffold = await launchWebScaffold({
    replayFixture: join(dir, 'session.jsonl'),
    compareReplaySession: false,
    extraOverlayPath: fileURLToPath(new URL('./forum-analysis.overlay.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('../../../packages/bundle/wanwei-desktop/package.json', import.meta.url))],
  })
  scaffold.ctx.provide('wanweiForumBilling', {
    quote: async () => ({ credits: 1, version: 1, cached: false, action: 'qa' }),
    run: async (_input, _signal, execute) => execute(),
  })
  await scaffold.ctx.loader.await()
  let sessionId: SessionId | undefined
  const stop = scaffold.ctx.on('session/created', (session) => { sessionId = session.id })
  try {
    const response = await scaffold.hostFetch('/api/desktop-forum/stream', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, selection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }),
    })
    expect(response.status).toBe(200)
    const frames = (await response.text()).trim().split('\n').map(line => JSON.parse(line) as { type: string })
    expect(frames.at(-1)).toMatchObject({ result: { ok: true, value: {
      text: '本文的核心要点是建设规划实施监测网络。', provider: 'deepseek-official', model: 'deepseek-v4-flash',
    } } })
    if (sessionId === undefined) throw new Error('analysis did not create a session')
    const saved = await scaffold.ctx.sessionPersistence.load(sessionId)
    const actual = [JSON.stringify({ type: 'session', ...saved.meta }),
      ...saved.events.map(({ seq: _seq, ...event }) => JSON.stringify(event))].join('\n') + '\n'
    const normalize = (raw: string) => normalizeSessionSnapshots([raw], { sessionIds: [], cwd: '\0no-cwd\0' })[0]
    if (webSnapshotMode() === 'refresh') {
      fixture = normalize(actual) ?? ''
      await writeFile(join(dir, 'session.jsonl'), fixture)
    }
    expect(normalize(actual)).toBe(normalize(fixture))
    const header = saved.events.find(event => event.type === 'request/header')
    if (header?.type !== 'request/header') throw new Error('analysis has no request header')
    if (webSnapshotMode() === 'refresh') {
      await writeFile(join(dir, 'system-prompt.expected.md'), formatSystemPromptSnapshot(header.data.header.system ?? '', []))
      await writeFile(join(dir, 'tool-schemas.expected.json'), formatToolSchemasSnapshot(header.data.header.tools ?? [], []))
    }
    expect(formatSystemPromptSnapshot(header.data.header.system ?? '', []))
      .toBe(await readFile(join(dir, 'system-prompt.expected.md'), 'utf8'))
    expect(formatToolSchemasSnapshot(header.data.header.tools ?? [], []))
      .toBe(await readFile(join(dir, 'tool-schemas.expected.json'), 'utf8'))
  } finally { stop(); await scaffold.close() }
})
