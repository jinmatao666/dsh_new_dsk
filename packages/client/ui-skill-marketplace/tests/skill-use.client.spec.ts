import { describe, expect, it, vi } from 'vitest'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { startSkillUse } from '../src/client/skill-use.ts'

describe('installed skill use', () => {
  it('opens chat with only the skill token as a draft and never sends', () => {
    const clear = vi.fn()
    const setPendingDraft = vi.fn()
    const sessions = { clear } as unknown as Pick<ISessions, 'clear'>
    const conversation = { input: { setPendingDraft } } as unknown as Pick<IConversation, 'input'>
    startSkillUse(sessions, conversation, 'market-pdf-to-image')
    expect(setPendingDraft).toHaveBeenCalledExactlyOnceWith('/market-pdf-to-image')
    expect(clear).toHaveBeenCalledOnce()
  })
})
