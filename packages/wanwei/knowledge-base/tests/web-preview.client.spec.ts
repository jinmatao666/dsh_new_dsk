// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { extractWebSourceUrl, prepareEmbeddedWebPreview } from '../src/client/web-preview.ts'

describe('web source url', () => {
  it('reads canonical when wanwei meta is absent', () => {
    const raw = `<!doctype html><html><head>
      <link rel="canonical" href="https://www.cnblogs.com/wangboyu/p/14463680.html">
    </head><body><p>hi</p></body></html>`
    expect(extractWebSourceUrl(raw)).toBe('https://www.cnblogs.com/wangboyu/p/14463680.html')
  })

  it('prefers the wanwei source meta over canonical', () => {
    const raw = `<!doctype html><html><head>
      <meta name="wanwei-source-url" content="https://example.com/imported">
      <link rel="canonical" href="https://cdn.example.com/mirror">
    </head><body><p>hi</p></body></html>`
    expect(extractWebSourceUrl(raw)).toBe('https://example.com/imported')
  })

  it('rejects non-http URLs', () => {
    const raw = `<!doctype html><html><head>
      <meta name="wanwei-source-url" content="javascript:alert(1)">
    </head><body></body></html>`
    expect(extractWebSourceUrl(raw)).toBeUndefined()
  })
})

describe('embedded web preview', () => {
  it('keeps page chrome and injects base for the source origin', () => {
    const raw = `<!doctype html><html><head>
      <meta http-equiv="Content-Security-Policy" content="frame-ancestors 'none'">
      <title>MySQL修改connect_timeout</title>
      <link rel="stylesheet" href="/bundle.css">
    </head><body>
      <nav>博客园</nav>
      <article>telnet 10.5.36.* 3306</article>
    </body></html>`
    const html = prepareEmbeddedWebPreview(raw, 'https://www.cnblogs.com/wangboyu/p/14463680.html')
    expect(html).toContain('<base href="https://www.cnblogs.com/wangboyu/p/14463680.html">')
    expect(html).toContain('博客园')
    expect(html).toContain('telnet 10.5.36.* 3306')
    expect(html).toContain('/bundle.css')
    expect(html).not.toContain('Content-Security-Policy')
  })
})
