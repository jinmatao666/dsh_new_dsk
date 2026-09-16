import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const productRoot = resolve(import.meta.dirname, '..')
const release = readJson(resolve(productRoot, 'src-tauri', 'tauri.conf.json'))
const development = readJson(resolve(productRoot, 'src-tauri', 'tauri.dev.conf.json'))

const expected = {
  productName: '万维 Buddy 预览版',
  releaseIdentifier: 'com.wanwei.harness.preview',
  developmentIdentifier: 'com.wanwei.harness.preview.development',
}

assertEqual(release.productName, expected.productName, 'preview product name')
assertEqual(release.identifier, expected.releaseIdentifier, 'preview release identifier')
assertEqual(development.identifier, expected.developmentIdentifier, 'preview development identifier')
if (release.identifier === development.identifier) fail('release and development identifiers must differ')
if (release.identifier === 'com.wanwei.harness') fail('preview must not reuse the installed production identifier')

process.stdout.write('Wanwei desktop preview identity is isolated from the installed production app.\n')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function assertEqual(actual, expectedValue, label) {
  if (actual !== expectedValue) fail(`${label}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actual)}`)
}

function fail(message) {
  throw new Error(message)
}
