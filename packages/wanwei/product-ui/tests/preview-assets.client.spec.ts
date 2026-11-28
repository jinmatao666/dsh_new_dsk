// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { inlinePreviewAssets } from '../src/client/preview-assets.ts'

describe('document-local preview resources', () => {
  it('embeds workspace-relative Markdown images while refusing paths outside the workspace', async () => {
    const read = vi.fn(async () => btoa('image bytes'))
    const source = btoa('![local](../images/photo.png)\n![outside](../../outside.png)')
    const output = atob(await inlinePreviewAssets(source, ['docs', 'readme.md'], '/workspace', read))
    expect(output).toContain('data:image/png;base64,' + btoa('image bytes'))
    expect(output).toContain('../../outside.png')
    expect(read).toHaveBeenCalledExactlyOnceWith('read_workspace_preview', { root: '/workspace', parts: ['images', 'photo.png'] })
  })
})
