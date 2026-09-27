import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { removeStagedEntry } from './runtime-files.mjs'

test('removing a staged dependency link preserves the original package', () => {
  const root = mkdtempSync(join(tmpdir(), 'wanwei-staged-link-'))
  const source = join(root, '源代码 有空格')
  const target = join(root, 'staged-link')
  try {
    mkdirSync(source)
    writeFileSync(join(source, 'keep.txt'), 'source stays intact')
    symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir')
    removeStagedEntry(target)
    assert.equal(existsSync(target), false)
    assert.equal(readFileSync(join(source, 'keep.txt'), 'utf8'), 'source stays intact')
    removeStagedEntry(target)
  } finally {
    removeStagedEntry(target)
    rmSync(root, { recursive: true, force: true })
  }
})

test('removing an ordinary staged directory only removes that directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'wanwei-staged-directory-'))
  try {
    const target = join(root, 'package')
    mkdirSync(target)
    writeFileSync(join(target, 'index.js'), 'export {}')
    writeFileSync(join(root, 'sibling.txt'), 'keep')
    removeStagedEntry(target)
    assert.equal(existsSync(target), false)
    assert.equal(readFileSync(join(root, 'sibling.txt'), 'utf8'), 'keep')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
