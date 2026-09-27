// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { skillDisplayName, startSkillUse } from '../src/client/skill-use.ts'

afterEach(() => { localStorage.clear() })

describe('marketplace skill handoff', () => {
  it('stages an editable skill token and returns to the no-Session composer without submitting', () => {
    const clear = vi.fn()
    const setStagedDraft = vi.fn()
    startSkillUse({ clear }, { setStagedDraft }, 'office-meeting-minutes', '会议纪要')
    expect(setStagedDraft).toHaveBeenCalledWith('/office-meeting-minutes')
    expect(clear).toHaveBeenCalledOnce()
    expect(skillDisplayName('office-meeting-minutes')).toBe('会议纪要')
  })
})
