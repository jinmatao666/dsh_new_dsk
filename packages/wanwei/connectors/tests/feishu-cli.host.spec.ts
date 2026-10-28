import { describe, expect, it } from 'vitest'
import { parseFeishuAuthenticated, parseFeishuAuthorizationUrl, parseFeishuError, parseFeishuAuthorizationResult } from '../src/feishu-cli.ts'

describe('Feishu CLI status', () => {
  it('reads partial login NDJSON and safe missing scopes without exposing credentials', () => {
    const raw = '{"event":"device_authorization","device_code":"SECRET"}\n'
      + '{"event":"authorization_complete","scope":"contact:contact:read","missing":["im:message.send_as_user","--unsafe", "token=SECRET"],"warning":{"hint":"some permissions not granted"}}\n'
    expect(parseFeishuAuthorizationResult(raw)).toEqual({ completed: true, missingScopes: ['im:message.send_as_user'] })
    expect(JSON.stringify(parseFeishuAuthorizationResult(raw))).not.toContain('SECRET')
    const stderr = 'Progress\n{"ok":false,"error":{"type":"authorization","subtype":"missing_scope","missing_scopes":["im:message.send_as_user"],"message":"SECRET"}}\nDone\n'
    expect(parseFeishuError(stderr)).toEqual({ type: 'authorization', subtype: 'missing_scope' })
    expect(parseFeishuAuthorizationResult(stderr)).toEqual({ completed: false, missingScopes: ['im:message.send_as_user'] })
  })

  it('distinguishes missing configuration without exposing credential-bearing error text', () => {
    expect(parseFeishuError(JSON.stringify({ ok: false, error: { type: 'config', subtype: 'not_configured', message: 'secret' } })))
      .toEqual({ type: 'config', subtype: 'not_configured' })
    expect(parseFeishuError('non-json secret')).toBeUndefined()
    expect(parseFeishuError('{"ok":false,"error":{"type":"token=secret","subtype":"unknown"}}')).toBeUndefined()
  })

  it('preserves complete verification URLs and ignores streamed fragments and help links', () => {
    const url = 'https://accounts.feishu.cn/verify?code=a%2fb&state=x%20y'
    expect(parseFeishuAuthorizationUrl(JSON.stringify({ verification_uri_complete: url }))).toBe(url)
    expect(parseFeishuAuthorizationUrl(`help: https://open.feishu.cn/document\n  ${url}\n`)).toBe(url)
    expect(parseFeishuAuthorizationUrl('  https://accounts.feishu.cn/ver')).toBeUndefined()
    expect(parseFeishuAuthorizationUrl('{"verification_uri_complete":"https://evil.example/verify"}')).toBeUndefined()
  })
  it('accepts only a ready or refreshable user identity', () => {
    expect(parseFeishuAuthenticated(JSON.stringify({ ok: true, identities: { user: { available: true, status: 'ready' } } }))).toBe(true)
    expect(parseFeishuAuthenticated(JSON.stringify({ ok: true, identities: { user: { available: true, status: 'needs_refresh' } } }))).toBe(true)
    expect(parseFeishuAuthenticated(JSON.stringify({ ok: true, identities: { user: { available: false, status: 'ready' } } }))).toBe(false)
    expect(parseFeishuAuthenticated(JSON.stringify({ ok: false, identities: { user: { available: true, status: 'ready' } } }))).toBe(false)
  })
})
