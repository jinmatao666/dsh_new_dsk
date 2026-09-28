/** One-time mechanical copy of the original expert artwork; no runtime dependency. */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const sourcePath = process.argv[2]
if (!sourcePath) throw new Error('Pass the original GeologyIconData.ts path explicitly')
const source = await readFile(resolve(sourcePath), 'utf8')
const sites = ['geology', 'third-survey', 'planning-review', 'meeting-minutes', 'file-conversion', 'document-processing']
const navigation = [
  ['home', 'workspace'],
  ['history', 'history'],
  ['files', 'files'],
  ['guide', 'guide'],
]
const productAssets = resolve(root, '..', 'products', 'wanwei-desktop', 'assets', 'web', 'expert-icons')
await mkdir(productAssets, { recursive: true })

for (const [filename] of navigation) {
  await copyFile(join(root, 'geology', 'web', 'assets', `${filename}.png`), join(productAssets, `${filename}.png`))
}
for (const name of ['result', 'layers']) {
  const encoded = new RegExp(`\\b${name}: 'data:image/png;base64,([^']+)'`).exec(source)?.[1]
  if (!encoded) throw new Error(`Original ${name} icon not found`)
  await writeFile(join(productAssets, `${name}.png`), Buffer.from(encoded, 'base64'))
}

for (const site of sites) {
  const assets = join(root, site, 'web', 'assets')
  const manifestPath = join(assets, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  let html = await readFile(join(root, site, 'web', 'index.html'), 'utf8')
  for (const [filename, sourceName] of navigation) {
    const image = `${filename}.png`
    const bytes = await readFile(join(productAssets, image))
    await copyFile(join(productAssets, image), join(assets, image))
    const entry = { filename: image, source: `GeologyIconData.ts:${sourceName}`, sha256: createHash('sha256').update(bytes).digest('hex') }
    const index = manifest.assets.findIndex(asset => asset.filename === image)
    if (index < 0) manifest.assets.push(entry)
    else manifest.assets[index] = entry
    const pattern = new RegExp(`(<button\\b[^>]*data-page="${filename}"[^>]*>)<svg\\b[\\s\\S]*?<\\/svg>`)
    if (!pattern.test(html)) throw new Error(`${site}: ${filename} navigation SVG not found`)
    html = html.replace(pattern, `$1<img class="ui-icon" src="/assets/${image}" alt="" aria-hidden="true">`)
  }
  await writeFile(join(root, site, 'web', 'index.html'), html)
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  process.stdout.write(`${site}: original navigation icons copied\n`)
}
