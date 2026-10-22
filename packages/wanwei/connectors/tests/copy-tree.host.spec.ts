import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyDirectoryTree } from '../src/copy-tree.ts'

describe('copyDirectoryTree', () => {
  it('copies nested files between non-ASCII paths and overwrites existing files', () => {
    const root = mkdtempSync(join(tmpdir(), 'copy-tree-'))
    const source = join(root, '万维Buddy', 'dws-cli')
    mkdirSync(join(source, 'references', '指南'), { recursive: true })
    writeFileSync(join(source, 'SKILL.md'), 'skill')
    writeFileSync(join(source, 'references', '指南', '说明.md'), 'guide')
    const dest = join(root, '技能', 'dws-cli')
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'SKILL.md'), 'stale')

    copyDirectoryTree(source, dest)

    expect(readFileSync(join(dest, 'SKILL.md'), 'utf8')).toBe('skill')
    expect(readFileSync(join(dest, 'references', '指南', '说明.md'), 'utf8')).toBe('guide')
  })
})
