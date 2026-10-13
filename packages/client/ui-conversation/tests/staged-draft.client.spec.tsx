// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import { InputHub } from '../src/client/input/hub.ts'
import type { SessionInputShell } from '../src/client/input/facade.ts'
import { ComposerContentEditable } from '../src/client/input/editor/ComposerContentEditable.tsx'

afterEach(cleanup)

describe('pre-Session draft', () => {
  it('creates nothing until send, deduplicates pending sends, and submits into the prepared Session', async () => {
    const open = vi.fn()
    const sessions = { list: { getSnapshot: () => ({ current: undefined }) }, open }
    const hub = new InputHub({ get: () => sessions } as unknown as Context, (() => ''))
    const setDraft = vi.fn()
    const submit = vi.fn()
    vi.spyOn(hub, 'shell').mockReturnValue({ setDraft, submit } as unknown as SessionInputShell)
    type Id = Parameters<InputHub['moveStagedDraftTo']>[0]
    let resolve!: (id: Id) => void
    const prepare = vi.fn(() => new Promise<Id>((done) => { resolve = done }))
    hub.setStagedDraft('/convert', prepare)
    hub.setStagedDraft('/convert 转成 PDF')
    expect(prepare).not.toHaveBeenCalled()
    const first = hub.submitStagedDraft()
    await hub.submitStagedDraft()
    expect(prepare).toHaveBeenCalledOnce()
    expect(hub.stagedSubmission.getSnapshot().busy).toBe(true)
    resolve('prepared' as Id)
    await first
    expect(setDraft).toHaveBeenCalledExactlyOnceWith('/convert 转成 PDF')
    expect(open).toHaveBeenCalledExactlyOnceWith('prepared')
    expect(submit).toHaveBeenCalledExactlyOnceWith('queue')
    expect(hub.stagedDraft.getSnapshot()).toBe('')
    expect(hub.stagedSubmission.getSnapshot()).toEqual({ available: false, busy: false })
  })

  it('preserves a failed preparation draft and clears preparation on manual workspace handoff', async () => {
    const hub = new InputHub({} as Context, (() => ''))
    const prepare = vi.fn(async () => { throw new Error('cannot create') })
    hub.setStagedDraft('/convert 任务', prepare)
    await expect(hub.submitStagedDraft()).rejects.toThrow('cannot create')
    expect(hub.stagedDraft.getSnapshot()).toBe('/convert 任务')
    expect(hub.stagedSubmission.getSnapshot()).toEqual({ available: true, busy: false })
    vi.spyOn(hub, 'shell').mockReturnValue({ setDraft: vi.fn() } as unknown as SessionInputShell)
    hub.moveStagedDraftTo('manual' as Parameters<InputHub['moveStagedDraftTo']>[0])
    await hub.submitStagedDraft()
    expect(prepare).toHaveBeenCalledOnce()
  })
  it('moves the pending text to a Session once without submitting it', () => {
    const hub = new InputHub({} as Context, (() => ''))
    const setDraft = vi.fn()
    vi.spyOn(hub, 'shell').mockReturnValue({ setDraft } as unknown as SessionInputShell)
    hub.setStagedDraft('/meeting-minutes 请分析这份录音')
    expect(hub.stagedDraft.getSnapshot()).toBe('/meeting-minutes 请分析这份录音')
    hub.moveStagedDraftTo('session-1' as Parameters<InputHub['moveStagedDraftTo']>[0])
    expect(setDraft).toHaveBeenCalledExactlyOnceWith('/meeting-minutes 请分析这份录音')
    expect(hub.stagedDraft.getSnapshot()).toBe('')
    expect(hub.takeStagedDraft()).toBe('')
  })

  it('lets the user edit text before a Session editor exists', () => {
    let draft = ''
    const view = render(<ComposerContentEditable editor={null} editable standaloneText="" onStandaloneInput={(text) => { draft = text }} />)
    const input = view.getByRole('textbox')
    expect(input.getAttribute('contenteditable')).toBe('true')
    input.textContent = '先写材料摘要'
    fireEvent.input(input)
    expect(draft).toBe('先写材料摘要')
    view.rerender(<ComposerContentEditable editor={null} editable standaloneText="外部草稿" onStandaloneInput={(text) => { draft = text }} />)
    expect(input.textContent).toBe('外部草稿')
  })
})
