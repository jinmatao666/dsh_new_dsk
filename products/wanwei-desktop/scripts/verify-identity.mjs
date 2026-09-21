import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const productRoot = resolve(import.meta.dirname, '..')
const release = readJson(resolve(productRoot, 'src-tauri', 'tauri.conf.json'))
const development = readJson(resolve(productRoot, 'src-tauri', 'tauri.dev.conf.json'))
const rustMain = readFileSync(resolve(productRoot, 'src-tauri', 'src', 'main.rs'), 'utf8')
const rustLib = readFileSync(resolve(productRoot, 'src-tauri', 'src', 'lib.rs'), 'utf8')

const expected = {
  productName: '万维 Buddy 预览版',
  releaseIdentifier: 'com.wanwei.harness.preview',
  developmentIdentifier: 'com.wanwei.harness.preview.development',
  bundleIcons: [
    'icons/32x32.png',
    'icons/128x128.png',
    'icons/128x128@2x.png',
    'icons/icon.icns',
    'icons/icon.ico',
  ],
}

assertEqual(release.productName, expected.productName, 'preview product name')
assertEqual(release.identifier, expected.releaseIdentifier, 'preview release identifier')
assertEqual(development.identifier, expected.developmentIdentifier, 'preview development identifier')
assertEqual(JSON.stringify(release.bundle?.icon), JSON.stringify(expected.bundleIcons), 'preview bundle icons')
if (release.identifier === development.identifier) fail('release and development identifiers must differ')
if (release.identifier === 'com.wanwei.harness') fail('preview must not reuse the installed production identifier')
if (!rustMain.includes('#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]')) {
  fail('Windows release executable must use the GUI subsystem so it does not open a console window')
}
if (!rustLib.includes('command.creation_flags(0x08000000)')) {
  fail('Windows release sidecar must use CREATE_NO_WINDOW')
}

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
