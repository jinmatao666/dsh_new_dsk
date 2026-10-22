import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
import { describe, expect, it, vi } from 'vitest'
import { SessionFileReferences } from '../src/file-references.ts'

describe('SessionFileReferences', () => {
  it('serves draft paths without an Agent or Session lookup', async () => {
    const ctx = new Context()
    const draftList = vi.fn(async () => [{ path: '/home/user/report.docx', kind: 'file' as const }])
    ctx.provide('fileReferences', { listDraft: draftList } as never)
    const adapter = new SessionFileReferences(ctx)
    const signal = new AbortController().signal
    expect(await adapter.draftList('report', signal)).toEqual([{ path: '/home/user/report.docx', kind: 'file' }])
    expect(draftList).toHaveBeenCalledWith('report', signal)
  })
  it('delegates the resolved Agent, query, and cancellation signal unchanged', async () => {
    const ctx = new Context()
    const candidates: FileReferenceCandidate[] = [{ path: 'src', kind: 'directory' }]
    const list = vi.fn(() => Promise.resolve(candidates))
    ctx.provide('fileReferences', { list } as never)
    const adapter = new SessionFileReferences(ctx)
    const agent = { id: 'target' } as unknown as Agent
    const signal = new AbortController().signal

    await expect(adapter.list(agent, 'sr', signal)).resolves.toBe(candidates)
    expect(list).toHaveBeenCalledWith(agent, 'sr', signal)
  })
})
