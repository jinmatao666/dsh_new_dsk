// Development-only extraction. Deployed experts use only their own copied assets.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourcePath = process.argv[2]
if (!sourcePath) throw new Error('Provide the legacy GeologyIconData.ts path')
const source = await readFile(sourcePath, 'utf8')
const root = fileURLToPath(new URL('.', import.meta.url))
for (const [site, key] of [['third-survey', 'layers'], ['planning-review', 'coordinate']]) {
  const encoded = new RegExp(`${key}: 'data:image/png;base64,([^']+)'`).exec(source)?.[1]
  if (!encoded) throw new Error(`Missing legacy icon: ${key}`)
  const bytes = Buffer.from(encoded, 'base64')
  const directory = resolve(root, site, 'web/assets')
  const manifestPath = resolve(directory, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const entry = manifest.assets.find(asset => asset.filename === 'expert.png')
  if (!entry) throw new Error(`Missing brand manifest entry: ${site}`)
  entry.source = `GeologyIconData.ts:${key}`
  entry.sha256 = createHash('sha256').update(bytes).digest('hex')
  await writeFile(resolve(directory, 'expert.png'), bytes)
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  process.stdout.write(`${site}: ${key} (${entry.sha256})\n`)
}
for (const site of ['geology', 'third-survey', 'planning-review']) {
  const directory = resolve(root, site, 'web/assets')
  const manifestPath = resolve(directory, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  for (const key of ['success', 'failed', 'running']) {
    const encoded = new RegExp(`${key}: 'data:image/png;base64,([^']+)'`).exec(source)?.[1]
    if (!encoded) throw new Error(`Missing legacy state icon: ${key}`)
    const bytes = Buffer.from(encoded, 'base64')
    const filename = `${key}.png`
    const entry = { filename, source: `GeologyIconData.ts:${key}`, sha256: createHash('sha256').update(bytes).digest('hex') }
    const index = manifest.assets.findIndex(asset => asset.filename === filename)
    if (index < 0) manifest.assets.push(entry)
    else manifest.assets[index] = entry
    await writeFile(resolve(directory, filename), bytes)
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  process.stdout.write(`${site}: copied legacy state icons\n`)
}
