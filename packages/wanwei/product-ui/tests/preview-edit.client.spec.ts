// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { normalizeDocxForWordSave, replaceDocxSelectionText } from '../src/client/parvis-preview-edit.ts'

describe('Parvis Word selection editing', () => {
  it('replaces a selection spanning different text runs while keeping formatting and other files', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Original </w:t></w:r><w:r><w:t>Word text</w:t></w:r></w:p></w:body></w:document>')
    zip.file('word/media/keep.bin', new Uint8Array([1, 2, 3]))
    const result = await replaceDocxSelectionText(await zip.generateAsync({ type: 'base64' }), {
      selectedText: 'Original Word', contextBefore: '', contextAfter: ' text', menu: { x: 0, y: 0 },
    }, 'Updated')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('replacement failed')
    const saved = await JSZip.loadAsync(await normalizeDocxForWordSave(result.base64), { base64: true })
    const document = new DOMParser().parseFromString(await saved.file('word/document.xml')!.async('text'), 'application/xml')
    expect([...document.getElementsByTagNameNS('*', 't')].map(node => node.textContent).join('')).toBe('Updated text')
    expect(document.getElementsByTagNameNS('*', 'b')).toHaveLength(1)
    expect(await saved.file('word/media/keep.bin')!.async('uint8array')).toEqual(new Uint8Array([1, 2, 3]))
  })
})
