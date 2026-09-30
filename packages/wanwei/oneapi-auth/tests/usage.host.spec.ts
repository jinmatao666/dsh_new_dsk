import { describe, expect, it } from 'vitest'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { skillUsages } from '../src/usage.ts'

const session = { id: 'session-a' } as Session
const event = (seq: number, type: SessionEvent['type'], data: unknown): SessionEvent =>
  ({ seq, type, data } as SessionEvent)

describe('skill usage event extraction', () => {
  it('counts a skill only when the official injector resolved its user reference', () => {
    const use = skillUsages(session, event(1, 'user/message', {
      source: { kind: 'skill-invocation', name: 'pdf-merge', form: 'instructions' },
      content: [{ type: 'text', text: 'Skill instructions' }],
    }))
    expect(use.map(item => [item.item_id, item.invocation_type])).toEqual([['pdf-merge', 'user_explicit']])
    expect(skillUsages(session, event(2, 'user/message', {
      source: { kind: 'user' }, content: [{ type: 'text', text: '/not-a-real-skill' }],
    }))).toEqual([])
  })

  it('excludes plugin-injected messages and ordinary tools', () => {
    expect(skillUsages(session, event(3, 'user/message', {
      source: { kind: 'plugin', plugin: 'example' }, content: [{ type: 'text', text: '/pdf-merge' }],
    }))).toEqual([])
    expect(skillUsages(session, event(4, 'tool/call', { name: 'bash', arguments: '{"name":"pdf-merge"}' }))).toEqual([])
  })

  it('counts repeated model skill calls as distinct events, but preserves retry IDs', () => {
    const first = event(5, 'tool/call', { name: 'skill', arguments: '{"name":"pdf-merge"}' })
    const second = event(6, 'tool/call', { name: 'skill', arguments: '{"name":"pdf-merge"}' })
    const firstID = skillUsages(session, first)[0]?.event_id
    expect(firstID).toBe(skillUsages(session, first)[0]?.event_id)
    expect(firstID).not.toBe(skillUsages(session, second)[0]?.event_id)
    expect(skillUsages(session, first)[0]?.invocation_type).toBe('model_auto')
  })
})
