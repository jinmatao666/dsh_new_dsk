/** One-time asset import only. Expert builds never run or depend on this tool. */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const source = process.argv[2]
if (!source) throw new Error('Provide the legacy client source directory as an explicit argument')
const mappings = {
  'file-conversion': {
    'office-icons.ts': { fileHome: 'home', fileHistory: 'history', fileFolder: 'files', fileGuide: 'guide', wordPdf: 'word-pdf', pdfImages: 'pdf-images', pdfOrganize: 'pdf-organize', imagesPdf: 'images-pdf', imageOptimize: 'image-optimize' },
    'OfficeExpertHeroImages.ts': { fileHero: 'hero' },
  },
  'document-processing': {
    'office-icons.ts': { docExpert: 'expert', docHome: 'home', docHistory: 'history', docFile: 'files', docInfo: 'guide', docSummary: 'summary', docCompare: 'compare' },
    'OfficeExpertHeroImages.ts': { documentHero: 'hero' },
  },
  'meeting-minutes': {
    'MeetingIconData.ts': { expert: 'expert', hero: 'hero', workbench: 'home', history: 'history', files: 'files', guide: 'guide', audio: 'audio', supplement: 'material', upload: 'new' },
  },
  geology: { 'GeologyIconData.ts': { mountain: 'expert', workspace: 'home', history: 'history', files: 'files', guide: 'guide', upload: 'upload' }, 'LandExpertHeroImages.ts': { geologyHero: 'hero' } },
  'third-survey': { 'GeologyIconData.ts': { mountain: 'expert', workspace: 'home', history: 'history', files: 'files', guide: 'guide', upload: 'upload' }, 'LandExpertHeroImages.ts': { thirdSurveyHero: 'hero' } },
  'planning-review': { 'GeologyIconData.ts': { mountain: 'expert', workspace: 'home', history: 'history', files: 'files', guide: 'guide', upload: 'upload' }, 'LandExpertHeroImages.ts': { planReviewHero: 'hero' } },
}
for (const [site, sources] of Object.entries(mappings)) {
  const output = join(root, site, 'web', 'assets')
  await mkdir(output, { recursive: true })
  const manifest = []
  for (const [file, names] of Object.entries(sources)) {
    const text = await readFile(join(resolve(source), file), 'utf8')
    const assets = new Map([...text.matchAll(/(?:export const\s+)?([A-Za-z][A-Za-z0-9_]*)\s*(?:=|:)\s*['"]data:image\/(png|webp);base64,([A-Za-z0-9+/=]+)['"]/g)].map(match => [match[1], match]))
    for (const [name, target] of Object.entries(names)) {
      const asset = assets.get(name)
      if (!asset) throw new Error(`Missing asset ${file}:${name}`)
      const data = Buffer.from(asset[3], 'base64')
      const filename = `${target}.${asset[2]}`
      await writeFile(join(output, filename), data, { flag: 'wx' })
      manifest.push({ filename, source: `${file}:${name}`, sha256: createHash('sha256').update(data).digest('hex') })
    }
  }
  await writeFile(join(output, 'manifest.json'), JSON.stringify({ purpose: 'Versioned legacy asset copies; no runtime dependency on the original repository', assets: manifest }, null, 2) + '\n', { flag: 'wx' })
  process.stdout.write(`${site}: imported ${manifest.length} assets\n`)
}
