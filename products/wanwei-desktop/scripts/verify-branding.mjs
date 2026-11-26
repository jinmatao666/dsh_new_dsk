import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadBrand, productRoot, brandedPackages } from './branding.mjs'

/** Verify compiled brand snapshots and staged assets before packaging the runtime. */
export async function verifyBranding(selection = loadBrand()) {
  const root = resolve(productRoot, '../..')
  const dist = join(root, 'apps/web/dist')
  const receipt = { schemaVersion: 1, name: selection.brand.name, assets: {} }
  if (selection.composed) {
    const bytes = readFileSync(join(dist, 'brand-wordmark.svg'))
    assert.deepEqual(bytes, selection.composed, 'Composed wordmark does not match this build')
    receipt.assets.wordmark = createHash('sha256').update(bytes).digest('hex')
  }
  for (const pkg of brandedPackages) {
    const path = join(root, 'packages/wanwei', pkg, 'lib/types/brand.generated.js')
    const { brand } = await import(pathToFileURL(path).href + `?verify=${Date.now()}`)
    assert.deepEqual(brand, selection.brand, `${pkg}: compiled brand does not match this build`)
  }
  for (const [slot, url] of Object.entries(selection.brand.assets)) {
    if (!url.startsWith('/brand/')) continue
    const bytes = readFileSync(join(dist, url.slice(1)))
    const expected = (slot === 'sidebar' && selection.sidebarWordmark) || readFileSync(selection.sources[slot])
    assert.deepEqual(bytes, expected, `Wrong brand asset: ${slot}`)
    receipt.assets[slot] = createHash('sha256').update(bytes).digest('hex')
  }
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8'))
  assert.equal(manifest.name, selection.brand.nameEn)
  writeFileSync(join(productRoot, '.brand-build/receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyBranding()
  console.log('Compiled desktop branding and per-slot assets verified.')
}
