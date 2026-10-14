import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { verifyInstallerData } from './verify-installer-data.mjs'

const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
const installer = readFileSync(new URL('../src-tauri/windows/installer.nsi', import.meta.url), 'utf8')
const hooks = readFileSync(new URL('../src-tauri/nsis-hooks.nsh', import.meta.url), 'utf8')
test('release installer preserves data and still removes application files', () => {
  verifyInstallerData(config, installer, hooks)
})
test('rejects restoring the upstream data-deletion checkbox', () => {
  assert.throws(() => verifyInstallerData(config, installer + '\nVar DeleteAppDataCheckbox', hooks))
})
test('rejects app-data removal in either the template or hooks', () => {
  for (const command of ['RmDir /r "$LOCALAPPDATA\\${BUNDLEID}"', 'Delete "$APPDATA\\settings.yaml"']) {
    assert.throws(() => verifyInstallerData(config, installer + '\n' + command, hooks))
    assert.throws(() => verifyInstallerData(config, installer, hooks + '\n' + command))
  }
})
test('rejects a different application identity or the default template', () => {
  assert.throws(() => verifyInstallerData({ ...config, identifier: 'another.app' }, installer, hooks))
  const changed = structuredClone(config)
  delete changed.bundle.windows.nsis.template
  assert.throws(() => verifyInstallerData(changed, installer, hooks))
})
