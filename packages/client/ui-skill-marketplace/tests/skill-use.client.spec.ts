import { describe, expect, it, vi } from 'vitest'
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { startSkillUse } from '../src/client/skill-use.ts'

function setup() {
  const state = { current: undefined as SessionId | undefined, byId: {} as Record<SessionId, { blank: boolean }> }
  const listeners = new Set<() => void>()
  const clear = vi.fn(() => { state.current = undefined })
  const sessions = {
    clear,
    list: {
      getSnapshot: () => state,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
  } as unknown as Pick<ISessions, 'clear' | 'list'>
  const open = (id: string, blank: boolean) => {
    const sessionId = id as SessionId
    state.current = sessionId
    state.byId[sessionId] = { blank }
    for (const listener of [...listeners]) listener()
  }
  return { sessions, clear, open, listeners }
}

describe('installed skill use', () => {
  it('waits for a newly selected workspace before invoking the skill once', () => {
    const { sessions, clear, open, listeners } = setup()
    const invoke = vi.fn()
    startSkillUse(sessions, 'market-pdf-to-image', invoke)
    expect(clear).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalled()
    open('new', true)
    open('other', true)
    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith('new', 'market-pdf-to-image')
    expect(listeners.size).toBe(0)
  })

  it('cancels when an existing conversation opens or the intent is disposed', () => {
    const { sessions, open, listeners } = setup()
    const invoke = vi.fn()
    startSkillUse(sessions, 'skill-a', invoke)
    open('existing', false)
    open('new', true)
    expect(invoke).not.toHaveBeenCalled()
    const cancel = startSkillUse(sessions, 'skill-b', invoke)
    cancel()
    open('later', true)
    expect(invoke).not.toHaveBeenCalled()
    expect(listeners.size).toBe(0)
  })
})
