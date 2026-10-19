import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { packageUpdate } from './package-update.mjs'

test('real Tauri signatures and upload ZIP are accepted by the backend', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'wanwei-updater-test-'))
  const productRoot = resolve(import.meta.dirname, '..')
  const repository = resolve(productRoot, '../..')
  const cli = join(productRoot, 'node_modules/@tauri-apps/cli/tauri.js')
  const previousKey = process.env.TAURI_SIGNING_PRIVATE_KEY
  const previousPassword = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  try {
    const key = join(temporary, 'ephemeral-test.key')
    const generate = spawnSync(process.execPath, [cli, 'signer', 'generate', '--ci', '-p', '', '-w', key], { encoding: 'utf8', windowsHide: true })
    assert.equal(generate.status, 0, 'Ephemeral Tauri test key generation failed')
    process.env.TAURI_SIGNING_PRIVATE_KEY = await readFile(key, 'utf8')
    process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
    const folder = join(temporary, 'bundle/nsis')
    await mkdir(folder, { recursive: true })
    const artifact = join(folder, 'test.exe')
    await writeFile(artifact, 'test-only signed installer')
    const sign = spawnSync(process.execPath, [cli, 'signer', 'sign', artifact], { encoding: 'utf8', windowsHide: true })
    assert.equal(sign.status, 0, 'Tauri test artifact signing failed')
    const archive = await packageUpdate({ platform: 'windows-x64', version: '1.2.0', output: temporary, bundleRoot: join(temporary, 'bundle') })
    const publicKey = (await readFile(`${key}.pub`, 'utf8')).trim()
    const backend = spawnSync('go', ['test', './controller', '-run', '^TestDesktopUpdateTauriInterop$', '-count=1'], {
      cwd: join(repository, 'services/one-api'), encoding: 'utf8', windowsHide: true, timeout: 180000,
      env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: '', TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '',
        DSH_UPDATE_TEST_ZIP: archive, DSH_UPDATE_TEST_PUBLIC_KEY: publicKey },
    })
    assert.equal(backend.status, 0, backend.stdout + backend.stderr)
    if (process.env.DSH_UPDATE_TEST_NATIVE === '1') {
      const native = spawnSync('cargo', ['test', '--manifest-path', join(productRoot, 'src-tauri/Cargo.toml'), 'desktop_update::tests::manifest_interop', '--', '--exact'], {
        cwd: repository, encoding: 'utf8', windowsHide: true, timeout: 600000,
        env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: '', TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '',
          DSH_UPDATE_TEST_ZIP: archive, DSH_UPDATE_TEST_PUBLIC_KEY: publicKey },
      })
      assert.equal(native.status, 0, native.stdout + native.stderr)
      assert.match(native.stdout, /1 passed/u)
    }
    await assert.rejects(packageUpdate({ platform: 'windows-x64', version: '1.2.0', output: temporary, bundleRoot: join(temporary, 'bundle') }), /生成更新 ZIP 失败/u)
    await assert.rejects(packageUpdate({ platform: 'windows-x64', version: '1.2.0-beta', output: temporary }), /正式版本号/u)
  } finally {
    if (previousKey === undefined) delete process.env.TAURI_SIGNING_PRIVATE_KEY; else process.env.TAURI_SIGNING_PRIVATE_KEY = previousKey
    if (previousPassword === undefined) delete process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD; else process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = previousPassword
    await rm(temporary, { recursive: true, force: true })
  }
})
