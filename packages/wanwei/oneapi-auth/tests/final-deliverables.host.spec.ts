import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { expect, it, vi } from 'vitest'
import { installFinalDeliverables } from '../src/final-deliverables.ts'

it('verifies final files through a Loader-composed filesystem and removes the declaration tool on disposal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wanwei-final-files-'))
  const ctx = new Context()
  try {
    await writeFile(join(root, 'final.docx'), 'real final content')
    const config = join(root, 'cordis.yml')
    await writeFile(config, ['- name: test-prompt', '- name: test-tools', '- name: test-fs', '- name: test-delivery'].join('\n'))
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['test-prompt', SystemPrompt], ['test-tools', ToolRuntime], ['test-fs', FsLocal],
      ['test-delivery', { apply: installFinalDeliverables }],
    ])
    ctx.loader.internal = { version: 'v2', async import(name: string) {
      if (!modules.has(name)) throw new Error(`Unknown fixture plugin: ${name}`)
      return modules.get(name)
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
    await ctx.loader.await()
    const session = Session.create(SessionId('final-files'))
    const owned = Session.create(session.id, [], { ...session.header, cwd: root })
    const steer = vi.fn<Agent['steer']>()
    const agent = { id: owned.id, session: owned, ctx: ctx.plugin(() => {}).ctx, steer } as unknown as Agent
    let sequence = 0
    const deliver = (paths: string[], owner: Agent | null = agent) => ctx.tools.execute({
      name: 'deliver_files', arguments: { paths }, callId: ToolCallId(`deliver-${++sequence}`),
      signal: new AbortController().signal, ...(owner === null ? {} : { agent: owner }),
    })
    const success = await deliver(['final.docx', './final.docx', join(root, 'final.docx')])
    expect(success.isError).toBe(false)
    expect(success.content).toEqual([{ type: 'text', text: `DSH_DELIVERABLES=${JSON.stringify([join(root, 'final.docx')])}` }])
    expect((await deliver(['missing.docx'])).isError).toBe(true)
    expect((await deliver(['.'])).isError).toBe(true)
    expect((await deliver([' '])).isError).toBe(true)
    expect((await deliver(['final.docx'], null)).isError).toBe(true)
    expect((await deliver(Array.from({ length: 129 }, () => 'final.docx'))).isError).toBe(true)
    expect((await deliver([])).content).toEqual([{ type: 'text', text: 'DSH_DELIVERABLES=[]' }])
    owned.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('write'), name: 'write', arguments: '{}' })
    owned.append('tool/result', { turn: 1, step: 1,
      message: createToolResultMessage({ callId: ToolCallId('write'), content: [], isError: false }),
    }, { surfaceOp: 'append' })
    await ctx.serial('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
    await ctx.serial('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
    expect(steer).toHaveBeenCalledOnce()
    const reminder = steer.mock.calls[0]?.[0].content[0]
    if (reminder?.type !== 'text') throw new Error('Expected a text reminder')
    expect(reminder.text).toContain('complete final output list')
    const settle = (turn: number, name: string, isError = false) => {
      const callId = ToolCallId(`${turn}-${name}-${owned.events.length}`)
      owned.append('tool/call', { turn, step: 1, callId, name, arguments: '{}' })
      owned.append('tool/result', { turn, step: 1,
        message: createToolResultMessage({ callId, content: [], isError }),
      }, { surfaceOp: 'append' })
    }
    const stopping = (turn: number, signal = new AbortController().signal) =>
      ctx.serial('agent/turn-stopping', { agent, turn, signal })
    settle(2, 'write')
    settle(2, 'deliver_files')
    await stopping(2)
    expect(steer).toHaveBeenCalledTimes(1)
    settle(2, 'edit')
    await stopping(2)
    expect(steer).toHaveBeenCalledTimes(2)
    settle(3, 'read')
    await stopping(3)
    expect(steer).toHaveBeenCalledTimes(2)
    settle(4, 'write')
    settle(4, 'deliver_files', true)
    await stopping(4)
    expect(steer).toHaveBeenCalledTimes(3)
    settle(5, 'write')
    await stopping(5, AbortSignal.abort())
    expect(steer).toHaveBeenCalledTimes(3)
    settle(6, 'write')
    settle(6, 'deliver_files')
    settle(6, 'deliver_files', true)
    await stopping(6)
    expect(steer).toHaveBeenCalledTimes(4)
    const tools = ctx.tools
    await ctx.fiber.dispose()
    expect(tools.get('deliver_files')).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
