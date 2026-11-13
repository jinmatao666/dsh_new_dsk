import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readBuildId } from './package-update.mjs'

test('build identity survives a missing sidecar without inventing or accepting a conflicting identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-identity-'))
  const old = process.env.DSH_DESKTOP_BUILD_ID
  try {
    delete process.env.DSH_DESKTOP_BUILD_ID
    await assert.rejects(readBuildId(join(dir, 'bundle')), /构建标识/u)
    process.env.DSH_DESKTOP_BUILD_ID = '123456789'
    assert.equal(await readBuildId(join(dir, 'bundle')), '123456789')
    await writeFile(join(dir, 'desktop-build-id.txt'), '123456789')
    assert.equal(await readBuildId(join(dir, 'bundle')), '123456789')
    process.env.DSH_DESKTOP_BUILD_ID = '987654321'
    await assert.rejects(readBuildId(join(dir, 'bundle')), /不一致/u)
    delete process.env.DSH_DESKTOP_BUILD_ID
    assert.equal(await readBuildId(join(dir, 'bundle')), '123456789')
    process.env.DSH_DESKTOP_BUILD_ID = 'invalid'
    await assert.rejects(readBuildId(join(dir, 'missing/bundle')), /构建标识/u)
  } finally {
    if (old === undefined) delete process.env.DSH_DESKTOP_BUILD_ID
    else process.env.DSH_DESKTOP_BUILD_ID = old
    await rm(dir, { recursive: true, force: true })
  }
})

test('CI invalidates only the product crate after cache restore and before installer compilation', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/wanwei-desktop-preview.yml', import.meta.url), 'utf8')
  const cache = workflow.indexOf('name: Cache Rust and Tauri output')
  const identity = workflow.indexOf('name: Set shared desktop build identity')
  const invalidate = workflow.indexOf('name: Invalidate cached desktop identity')
  const build = workflow.indexOf('name: Build platform installer')
  assert.ok(cache >= 0 && cache < identity && identity < invalidate && invalidate < build)
  assert.match(workflow.slice(invalidate, build), /cargo clean[^\n]+--release --package wanwei-buddy/u)
})
