import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..')
const officialRoots = [
  'packages/client',
  'packages/host',
  'packages/session-query',
  'apps/web',
]
const forbidden = /WANWEI_RESULT|DSH_ANALYSIS_VIEW|__ZJUGIS_NATIVE_INVOKE__|\b(?:Wanwei|ZJUGIS|OneAPI)\b|万维|专业智能助手/u
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.json', '.yml', '.yaml', '.svg'])
const violations = []

for (const root of officialRoots) {
  for (const path of walk(join(repositoryRoot, root))) {
    const normalized = path.replaceAll('\\', '/')
    if (normalized.includes('/tests/') || normalized.includes('/dist/') || normalized.includes('/lib/')) continue
    if (!sourceExtensions.has(extname(path))) continue
    const text = readFileSync(path, 'utf8')
    if (forbidden.test(text)) violations.push(relative(repositoryRoot, path))
  }
}

const publicRoot = join(repositoryRoot, 'apps', 'web', 'public')
for (const productAsset of ['brand-mark.svg', 'brand-wordmark.svg', 'connector-icons', 'skill-icons']) {
  try {
    statSync(join(publicRoot, productAsset))
    violations.push(`apps/web/public/${productAsset}`)
  } catch {
    // Absence is the required source-tree state; product builds stage these assets temporarily.
  }
}

if (violations.length > 0) {
  throw new Error(`Wanwei private implementation leaked into official DSH paths:\n${violations.join('\n')}`)
}
process.stdout.write('Wanwei product boundary verification passed.\n')

function* walk(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'target') continue
    const path = join(root, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.isFile()) yield path
  }
}
