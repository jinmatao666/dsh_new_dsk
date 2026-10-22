// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import type { DraftInputTriggers } from '../src/client/contract/input.ts'
import { InputHub } from '../src/client/input/hub.ts'
import type { SessionInputShell } from '../src/client/input/facade.ts'
import { ComposerContentEditable } from '../src/client/input/editor/ComposerContentEditable.tsx'
import { useStagedEditor } from '../src/client/input/editor/use-staged-editor.ts'
import { $getRoot } from 'lexical'
import type { LexicalEditor } from 'lexical'

afterEach(cleanup)

describe('pre-Session draft', () => {
  it('binds the editor when the optional trigger service arrives after the composer', () => {
    const ctx = new Context()
    const hub = new InputHub(ctx, (() => ''))
    const face = hub.draftTriggers()
    const apply = vi.fn(() => true)
    const detach = face.bindEditor(apply)
    const off = vi.fn()
    const bindEditor = vi.fn(() => off)
    const track = vi.fn()
    const controller = { bindEditor, track } as unknown as DraftInputTriggers
    ctx.provide('inputTriggers', { draft: () => controller } as never)
    face.track('/', 1, { tier: 'plain' }, 1)
    expect(bindEditor).toHaveBeenCalledExactlyOnceWith(apply)
    expect(track).toHaveBeenCalledWith('/', 1, { tier: 'plain' }, 1)
    detach()
    expect(off).toHaveBeenCalledOnce()
  })
  it('transfers structured references without invoking the automatic Workspace factory on manual selection', () => {
    const hub = new InputHub({} as Context, (() => ''))
    const prepare = vi.fn()
    hub.registerStagedSessionFactory(prepare)
    const setDraft = vi.fn()
    vi.spyOn(hub, 'shell').mockReturnValue({ setDraft } as unknown as SessionInputShell)
    const text = '/helper @/home/report.docx'
    const references = [{ occurrenceId: 1, source: 'skill', ref: '/helper', label: '助手', clipboardText: '/helper', offset: 0, length: 7 }]
    hub.setStagedDraft(text)
    hub.setStagedReferences(text, references)
    hub.moveStagedDraftTo('manual' as Parameters<InputHub['moveStagedDraftTo']>[0])
    expect(setDraft).toHaveBeenCalledExactlyOnceWith(text, references)
    expect(prepare).not.toHaveBeenCalled()
    expect(hub.stagedDraft.getSnapshot()).toBe('')
  })
  it('uses the registered default for plain drafts and applies choices before opening or sending', async () => {
    const order: string[] = []
    const sessions = { list: { getSnapshot: () => ({ current: undefined }) }, open: () => { order.push('open') } }
    const hub = new InputHub({ get: () => sessions } as unknown as Context, (() => ''))
    vi.spyOn(hub, 'shell').mockReturnValue({
      setDraft: () => { order.push('draft') }, submit: () => { order.push('send') },
    } as unknown as SessionInputShell)
    const prepare = vi.fn(async () => { order.push('allocate'); return 'default' as Parameters<InputHub['moveStagedDraftTo']>[0] })
    const dispose = hub.registerStagedSessionFactory(prepare)
    hub.registerStagedSessionTransfer(async () => { order.push('model-and-permission') })
    hub.setStagedDraft('普通新用户的问题')
    expect(prepare).not.toHaveBeenCalled()
    await hub.submitStagedDraft()
    expect(order).toMatchInlineSnapshot(`
      [
        "allocate",
        "model-and-permission",
        "draft",
        "open",
        "send",
      ]
    `)
    expect(hub.stagedSubmission.getSnapshot().available).toBe(true)
    dispose()
    expect(hub.stagedSubmission.getSnapshot().available).toBe(false)
  })

  it('keeps the draft editable when a pending choice cannot be applied', async () => {
    const sessions = { list: { getSnapshot: () => ({ current: undefined }) }, open: vi.fn() }
    const hub = new InputHub({ get: () => sessions } as unknown as Context, (() => ''))
    hub.registerStagedSessionFactory(async () => 'default' as Parameters<InputHub['moveStagedDraftTo']>[0])
    const dispose = hub.registerStagedSessionTransfer(async () => { throw new Error('model denied') })
    hub.setStagedDraft('保留这个问题')
    await expect(hub.submitStagedDraft()).rejects.toThrow('model denied')
    expect(hub.stagedDraft.getSnapshot()).toBe('保留这个问题')
    expect(hub.stagedSubmission.getSnapshot().busy).toBe(false)
    expect(sessions.open).not.toHaveBeenCalled()
    dispose()
  })

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

  it('uses the shared local editor for pre-Session text, sanitizes paste and accepts external drafts', async () => {
    const change = vi.fn()
    let editor: LexicalEditor | null = null
    function Surface({ text }: { text: string }) {
      editor = useStagedEditor({ active: true, text, editable: true, onChange: change, onError: vi.fn() })
      return <ComposerContentEditable editor={editor} editable />
    }
    const view = render(<Surface text="" />)
    const input = view.getByRole('textbox')
    expect(input.getAttribute('contenteditable')).toBe('true')
    act(() => { editor!.update(() => { $getRoot().selectEnd() }, { discrete: true }) })
    fireEvent.paste(input, { clipboardData: { items: [], getData: () => '\uE100先写\uFFFC材料摘要' } })
    await vi.waitFor(() => { expect(change).toHaveBeenCalledWith('先写材料摘要') })
    view.rerender(<Surface text="外部草稿" />)
    expect(input.textContent).toBe('外部草稿')
    view.rerender(<Surface text={'\uE100多行\n\uFFFC草稿'} />)
    expect(input.querySelectorAll('p').length).toBe(2)
    expect(input.textContent).toBe('多行草稿')
  })
})
