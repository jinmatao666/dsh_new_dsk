import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('./prepare-runner-config.mjs', import.meta.url))

function runConfig(platform, arch, verify) {
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
        DSH_RELEASE_VERSION: '2.0.8-preview.1',
        DSH_DESKTOP_SERVER_URL: 'http://127.0.0.1:3000',
      },
    })
    verify(result, directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

for (const [platform, arch] of [['linux-arm64', 'ARM64'], ['linux-x64', 'X64']]) {
  test(`${platform} generates versioned runner configuration`, () => {
    runConfig(platform, arch, (result, directory) => {
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(JSON.parse(readFileSync(join(directory, `wanwei-preview-${platform}.json`), 'utf8')), {
        version: '2.0.8-preview.1',
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
