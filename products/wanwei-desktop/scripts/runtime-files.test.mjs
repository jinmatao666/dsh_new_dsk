import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  pruneStagedRuntimeDevArtifacts,
  removeStagedEntry,
  shouldSkipStagedRuntimeEntry,
} from './runtime-files.mjs'

test('the production deploy root includes the product bundle and its registry dependencies', () => {
  const product = new URL('../runtime-closure/package.json', import.meta.url)
  const manifest = JSON.parse(readFileSync(product, 'utf8'))
  assert.equal(manifest.dependencies['@deepseek-ai/dsh-wanwei-desktop'], 'workspace:^')
  assert.equal(manifest.dependencies['@dingtalk-real-ai/dsh-dingtalk'], '^0.10.2')
})

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

test('staged runtime skips package tests that blow Windows MAX_PATH in NSIS', () => {
  assert.equal(shouldSkipStagedRuntimeEntry('tests', true), true)
  assert.equal(shouldSkipStagedRuntimeEntry('commands-create-fork.host.spec.ts', false), true)
  assert.equal(shouldSkipStagedRuntimeEntry('plugin.client.spec.tsx', false), true)
  assert.equal(shouldSkipStagedRuntimeEntry('lib', true), false)
  assert.equal(shouldSkipStagedRuntimeEntry('index.js', false), false)

  const root = mkdtempSync(join(tmpdir(), 'wanwei-prune-tests-'))
  try {
    const pkg = join(root, 'node_modules', '@deepseek-ai', 'dsh-api-session-controller')
    const tests = join(pkg, 'tests')
    mkdirSync(tests, { recursive: true })
    writeFileSync(join(tests, 'commands-create-fork.host.spec.ts'), 'export {}')
    writeFileSync(join(pkg, 'lib-index.js'), 'export {}')
    writeFileSync(join(pkg, 'accidental.host.spec.ts'), 'export {}')
    pruneStagedRuntimeDevArtifacts(root)
    assert.equal(existsSync(tests), false)
    assert.equal(existsSync(join(pkg, 'accidental.host.spec.ts')), false)
    assert.equal(readFileSync(join(pkg, 'lib-index.js'), 'utf8'), 'export {}')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
