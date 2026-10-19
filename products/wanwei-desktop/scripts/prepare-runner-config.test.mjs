import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('./prepare-runner-config.mjs', import.meta.url))

function runConfig(platform, arch, verify, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'wanwei-runner-config-'))
  try {
    const result = spawnSync(process.execPath, [script, platform], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        RUNNER_OS: 'Linux',
        RUNNER_ARCH: arch,
        RUNNER_TEMP: directory,
        DSH_RELEASE_VERSION: '2.1.0',
        DSH_DESKTOP_SERVER_URL: 'http://127.0.0.1:3000',
        DSH_BUILD_UPDATES: 'false',
        DSH_DESKTOP_UPDATE_PUBLIC_KEY: '',
        ...overrides,
      },
    })
    verify(result, directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('signed update builds refuse missing key configuration', () => {
  runConfig('linux-x64', 'X64', result => {
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /缺少签名密钥/u)
  }, { DSH_BUILD_UPDATES: 'true', TAURI_SIGNING_PRIVATE_KEY: '', DSH_DESKTOP_UPDATE_PUBLIC_KEY: '' })
})

test('signed update builds enable updater artifacts without replacing platform settings', () => {
  runConfig('linux-x64', 'X64', (result, directory) => {
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(readFileSync(join(directory, 'wanwei-linux-x64.json'), 'utf8')).bundle.createUpdaterArtifacts, true)
  }, { DSH_BUILD_UPDATES: 'true', TAURI_SIGNING_PRIVATE_KEY: 'test-configuration-only', DSH_DESKTOP_UPDATE_PUBLIC_KEY: 'test-configuration-only' })
})

test('ordinary installers embed the configured public key without requiring a private key', () => {
  runConfig('linux-x64', 'X64', (result, directory) => {
    assert.equal(result.status, 0, result.stderr)
    const config = JSON.parse(readFileSync(join(directory, 'wanwei-linux-x64.json'), 'utf8'))
    assert.equal(config.plugins.updater.pubkey, 'public-test-value')
    assert.equal(config.plugins.updater.dangerousInsecureTransportProtocol, true)
    assert.equal(config.bundle, undefined)
  }, { DSH_DESKTOP_UPDATE_PUBLIC_KEY: 'public-test-value', TAURI_SIGNING_PRIVATE_KEY: '' })
})

for (const [platform, arch] of [['linux-arm64', 'ARM64'], ['linux-x64', 'X64']]) {
  test(`${platform} generates versioned runner configuration`, () => {
    runConfig(platform, arch, (result, directory) => {
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(JSON.parse(readFileSync(join(directory, `wanwei-${platform}.json`), 'utf8')), {
        version: '2.1.0',
      })
    })
  })
}

for (const [platform, arch] of [['linux-arm64', 'X64'], ['linux-x64', 'ARM64']]) {
  test(`${platform} rejects a mismatched runner architecture`, () => {
    runConfig(platform, arch, result => {
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /必须在 .* Runner 上构建/u)
    })
  })
}
