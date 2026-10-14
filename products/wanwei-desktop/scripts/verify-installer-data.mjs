import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Reject installer configuration or commands that can erase persistent user data. */
export function verifyInstallerData(config, installer, hooks) {
  assert.equal(config.identifier, 'com.wanwei.harness', 'Release identity must preserve the data directory')
  assert.equal(config.bundle.windows.nsis.template, 'windows/installer.nsi')
  const code = (installer + '\n' + hooks).split('\n').filter(line => !line.trimStart().startsWith(';')).join('\n')
  assert.doesNotMatch(code, /DeleteAppDataCheckbox|\$\(deleteAppData\)/iu, 'Uninstall must not offer application-data deletion')
  assert.doesNotMatch(code, /(?:RmDir|Delete)\s+[^\n]*(?:\$APPDATA|\$LOCALAPPDATA|\$PROFILE)/iu,
    'Installer and hooks must not remove user data')
  assert.match(installer, /Section Uninstall/u)
  assert.match(installer, /Delete "\$INSTDIR\\uninstall\.exe"/u)
  assert.match(installer, /NSIS_HOOK_PREUNINSTALL/u)
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '..', 'src-tauri')
  const config = JSON.parse(readFileSync(resolve(root, 'tauri.conf.json'), 'utf8'))
  verifyInstallerData(config,
    readFileSync(resolve(root, config.bundle.windows.nsis.template), 'utf8'),
    readFileSync(resolve(root, config.bundle.windows.nsis.installerHooks), 'utf8'))
  console.log('Installer data policy passed: stable identity, no data-deletion UI or app-data removal.')
}
