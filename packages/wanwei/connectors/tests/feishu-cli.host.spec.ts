import { describe, expect, it } from 'vitest'
import { parseFeishuAuthenticated } from '../src/feishu-cli.ts'

describe('Feishu CLI status', () => {
  it('accepts only a ready or refreshable user identity', () => {
    expect(parseFeishuAuthenticated(JSON.stringify({ ok: true, identities: { user: { available: true, status: 'ready' } } }))).toBe(true)
    expect(parseFeishuAuthenticated(JSON.stringify({ ok: true, identities: { user: { available: true, status: 'needs_refresh' } } }))).toBe(true)
    expect(parseFeishuAuthenticated(JSON.stringify({ ok: true, identities: { user: { available: false, status: 'ready' } } }))).toBe(false)
    expect(parseFeishuAuthenticated(JSON.stringify({ ok: false, identities: { user: { available: true, status: 'ready' } } }))).toBe(false)
  })
})
