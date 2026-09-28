import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const productIcons = resolve(root, '..', 'products', 'wanwei-desktop', 'assets', 'web', 'expert-icons')
const sites = ['geology', 'third-survey', 'planning-review', 'meeting-minutes', 'file-conversion', 'document-processing']
const navigation = ['home', 'history', 'files', 'guide']

test('all six independent expert sites use the same original four navigation icons', async () => {
  const productHashes = new Map()
  for (const name of navigation) {
    const bytes = await readFile(join(productIcons, `${name}.png`))
    productHashes.set(name, createHash('sha256').update(bytes).digest('hex'))
  }
  for (const site of sites) {
    const base = join(root, site, 'web')
    const html = await readFile(join(base, 'index.html'), 'utf8')
    const nav = /<nav>(.*?)<\/nav>/s.exec(html)?.[1]
    assert.ok(nav, `${site}: navigation missing`)
    const manifest = JSON.parse(await readFile(join(base, 'assets', 'manifest.json'), 'utf8'))
    for (const name of navigation) {
      assert.match(nav, new RegExp(`<button[^>]+data-page="${name}"[^>]*><img class="ui-icon" src="/assets/${name}\\.png"`), `${site}: ${name}`)
      const bytes = await readFile(join(base, 'assets', `${name}.png`))
      const hash = createHash('sha256').update(bytes).digest('hex')
      assert.equal(hash, productHashes.get(name), `${site}: ${name} differs from original`)
      assert.equal(manifest.assets.find(asset => asset.filename === `${name}.png`)?.sha256, hash)
    }
  }
})

test('the original four detail icons are staged by the Wanwei product build', async () => {
  const build = await readFile(resolve(root, '..', 'products', 'wanwei-desktop', 'scripts', 'build-dsh.mjs'), 'utf8')
  assert.match(build, /'expert-icons'/)
  for (const name of ['home', 'files', 'result', 'layers']) {
    const bytes = await readFile(join(productIcons, `${name}.png`))
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  }
})
