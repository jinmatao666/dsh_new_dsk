import { describe, expect, it } from 'vitest'
import { importedFileReference } from '../src/client/imported-file-reference.ts'

describe('imported file reference', () => {
  it.each(['3 (1).txt', '资料/修正 表.xlsx', 'C:\\资料\\修正 表.xlsx'])('keeps %s as a path but labels it as a file', (path) => {
    const reference = importedFileReference(path)
    expect(reference.label).toBe(path.split(/[\\/]/u).at(-1))
    expect(reference.appearance).toBe('file')
    expect(reference.ref).toBe(`@"${path}"`)
    expect(reference.clipboardText).toBe(reference.ref)
    expect(reference.source).toBe('reference')
  })
  it('presents a folder with its original reference', () => {
    expect(importedFileReference('资料/输入/')).toEqual({ source: 'reference', ref: '@资料/输入/', clipboardText: '@资料/输入/', label: '输入/', appearance: 'folder' })
  })
  it.each(['', 'bad"name.txt', 'bad\nname.txt'])('rejects an unrepresentable path %j', (path) => {
    expect(() => importedFileReference(path)).toThrow()
  })
})
