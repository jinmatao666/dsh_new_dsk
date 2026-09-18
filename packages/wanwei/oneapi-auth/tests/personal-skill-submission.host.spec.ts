import { describe, expect, it } from 'vitest'
import { internals } from '../src/index.ts'

describe('personal skill submission parsing', () => {
  it('accepts a validated private or public directory bundle', () => {
    const parsed = internals.personalSkillSubmission({
      slug: 'meeting-notes',
      displayName: '会议纪要',
      category: '办公文档',
      icon: 'glyph:document',
      description: '整理会议内容',
      visibility: 'public',
      body: '---\nname: meeting-notes\n---',
      files: [{ path: 'SKILL.md', contentBase64: 'IyBUZXN0' }],
    })
    expect(parsed.visibility).toBe('public')
    expect(parsed.files).toHaveLength(1)
  })

  it('rejects an unsupported visibility', () => {
    expect(() => internals.personalSkillSubmission({
      slug: 'meeting-notes', displayName: '会议纪要', category: '办公文档', icon: 'glyph:document',
      visibility: 'team', body: '', files: [{ path: 'SKILL.md', contentBase64: 'IyBUZXN0' }],
    })).toThrow('个人技能可见范围无效')
  })
})
