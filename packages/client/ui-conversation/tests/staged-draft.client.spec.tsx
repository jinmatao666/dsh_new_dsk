// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import { InputHub } from '../src/client/input/hub.ts'
import type { SessionInputShell } from '../src/client/input/facade.ts'
import { ComposerContentEditable } from '../src/client/input/editor/ComposerContentEditable.tsx'

afterEach(cleanup)

describe('pre-Session draft', () => {
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
