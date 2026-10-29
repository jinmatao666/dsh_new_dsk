import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

test('installer stops orphaned runtime processes only inside its installation', { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
  const temp = mkdtempSync(join(tmpdir(), 'wanwei-install-test-'))
  const root = join(temp, "应用's install")
  const neighbor = root + '-other'
  const children = []
  const script = fileURLToPath(new URL('../src-tauri/windows/stop-installation-processes.ps1', import.meta.url))
  const powershell = join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe')
  const cleanup = (directory) => spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    '& ([scriptblock]::Create([IO.File]::ReadAllText($env:WANWEI_INSTALL_STOP_SCRIPT))) -InstallDirectory $env:WANWEI_INSTALL_ROOT'], {
    windowsHide: true, encoding: 'utf8', timeout: 25000,
    env: { ...process.env, WANWEI_INSTALL_STOP_SCRIPT: script, WANWEI_INSTALL_ROOT: directory, WANWEI_INSTALLER_PID: String(process.pid) },
  })
  try {
    for (const location of [join(root, 'node.exe'), join(root, 'resources/lark/lark-cli.exe'), join(neighbor, 'node.exe')]) {
      mkdirSync(join(location, '..'), { recursive: true })
      copyFileSync(process.execPath, location)
      const child = spawn(location, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' })
      children.push(child)
      await once(child, 'spawn')
    }
    const exits = children.slice(0, 2).map(child => once(child, 'exit'))
    const result = cleanup(root)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    await Promise.all(exits)
    assert.equal(children[2].exitCode, null)
    assert.doesNotThrow(() => process.kill(children[2].pid, 0))
    assert.equal(cleanup(root).status, 0, 'repeated cleanup is safe')
    assert.equal(cleanup(process.env.USERPROFILE).status, 1, 'reject broad user directory')
    assert.equal(cleanup('C:\\').status, 1, 'reject drive root')
    assert.doesNotThrow(() => process.kill(children[2].pid, 0))
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        child.kill()
        await exited
      }
    }
    rmSync(temp, { recursive: true, force: true })
  }
})
