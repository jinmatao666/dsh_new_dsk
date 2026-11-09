import { describe, expect, it } from 'vitest'
import { isValidWebLink, parseWebLinkInput, WEB_LINK_MAX_COUNT } from '../src/client/web-links.ts'

describe('web link validation', () => {
  it('accepts public http(s) URLs and rejects localhost or non-http schemes', () => {
    expect(isValidWebLink('https://www.cnblogs.com/wangboyu/p/14463680.html')).toBe(true)
    expect(isValidWebLink('http://example.com/a')).toBe(true)
    expect(isValidWebLink('ftp://example.com/a')).toBe(false)
    expect(isValidWebLink('https://user:pass@example.com/a')).toBe(false)
    expect(isValidWebLink('https://localhost/a')).toBe(false)
    expect(isValidWebLink('https://127.0.0.1/a')).toBe(false)
    expect(isValidWebLink('not a url')).toBe(false)
  })

  it('parses newline input with a max of ten unique URLs', () => {
    expect(parseWebLinkInput('')).toEqual({ ok: false, messageKey: '请输入网页链接' })
    expect(parseWebLinkInput('bad')).toEqual({
      ok: false, messageKey: '链接格式无效', invalidLine: 'bad',
    })
    const tooMany = Array.from({ length: WEB_LINK_MAX_COUNT + 1 }, (_, index) => `https://example.com/${index}`).join('\n')
    expect(parseWebLinkInput(tooMany)).toEqual({ ok: false, messageKey: '一次最多导入 10 条链接' })
    expect(parseWebLinkInput('https://example.com/a\n\nhttps://example.com/a\nhttps://example.com/b')).toEqual({
      ok: true, urls: ['https://example.com/a', 'https://example.com/b'],
    })
  })
})
