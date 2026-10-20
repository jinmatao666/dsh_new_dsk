import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import {
  buildWeComCliStatus,
  cancelWeComCliLoginFlight,
  disconnectWeComCli,
  runWeComCliLogin,
  invalidateWeComCliStatusCache,
  installWeComCliSkills,
  registerWeComCliRpc,
  resolveBundledWeComCli,
  resolveBundledWeComSkillsDir,
  resolveWeComCliCommand,
  resolveWeComConfigDir,
  wecomPlatformPackageName,
  wecomSharedSkillDir,
} from '../src/wecom-cli.ts'
import { apply, inject, name } from '../src/index.ts'

const originalPath = process.env.PATH
const originalPathWin = process.env.Path

afterEach(() => {
  cancelWeComCliLoginFlight()
  vi.restoreAllMocks()
  invalidateWeComCliStatusCache()
  delete process.env.DSH_HOME
  delete process.env.WECOM_CLI_CONFIG_DIR
  delete process.env.DSH_WECOM_CLI
  delete process.env.DSH_NODE_BINARY
  delete process.env.DSH_BUNDLE_ANCHORS
  delete process.env.DSH_WECOM_SKILLS_DIR
  delete process.env.DSH_DESKTOP_DEVELOPMENT
  if (originalPath === undefined) delete process.env.PATH
  else process.env.PATH = originalPath
  if (originalPathWin === undefined) delete process.env.Path
  else process.env.Path = originalPathWin
})

/** Point `DSH_WECOM_CLI` at a node script. The script body is ESM. */
function installFakeWeCom(cliDir: string, body: string): void {
  const node = process.execPath.replace(/"/g, '')
  const script = join(cliDir, 'fake-wecom.mjs')
  writeFileSync(script, body)
  const command = process.platform === 'win32' ? join(cliDir, 'wecom-cli.cmd') : join(cliDir, 'wecom-cli')
  if (process.platform === 'win32') {
    writeFileSync(command, `@echo off\r\n"${node}" "%~dp0fake-wecom.mjs" %*\r\n`)
  } else {
    writeFileSync(command, '#!/bin/sh\nexec "' + node + '" "$(dirname "$0")/fake-wecom.mjs" "$@"\n')
    chmodSync(command, 0o755)
  }
  process.env.DSH_WECOM_CLI = command
  process.env.PATH = ''
  process.env.Path = ''
}

describe('WeCom CLI Host helpers', () => {
  it('resolves config dir from WECOM_CLI_CONFIG_DIR or platform defaults', () => {
    expect(resolveWeComConfigDir({ WECOM_CLI_CONFIG_DIR: 'D:/cfg/wecom' })).toBe('D:/cfg/wecom')
    expect(resolveWeComConfigDir({ HOME: '/home/u' })).toBe(join('/home/u', '.config', 'wecom'))
    expect(resolveWeComConfigDir({ USERPROFILE: 'D:/Users/u' }))
      .toBe(join('D:/Users/u', '.config', 'wecom'))
  })

  it('prefers DSH_WECOM_CLI and a staged runtime binary over PATH', () => {
    const root = mkdtempSync(join(tmpdir(), 'wanwei-wecom-bundle-'))
    const pkg = wecomPlatformPackageName()
    expect(pkg).toBeTypeOf('string')
    const binaryName = process.platform === 'win32' ? 'wecom-cli.exe' : 'wecom-cli'
    const binary = join(root, 'app', 'node_modules', ...(pkg as string).split('/'), 'bin', binaryName)
    mkdirSync(dirname(binary), { recursive: true })
    writeFileSync(binary, '')
    const nodeBin = join(root, process.platform === 'win32' ? 'node.exe' : 'node')
    writeFileSync(nodeBin, '')
    expect(resolveBundledWeComCli({ DSH_NODE_BINARY: nodeBin })).toBe(binary)
    const override = join(root, 'custom-wecom')
    writeFileSync(override, '')
    expect(resolveBundledWeComCli({ DSH_WECOM_CLI: override })).toBe(override)
  })

  it('resolves staged WeCom skills beside DSH_NODE_BINARY and refuses GitHub fetch in production', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wanwei-wecom-skills-'))
    const skills = join(root, 'app', 'assets', 'wecom-skills', 'wecomcli-shared')
    mkdirSync(skills, { recursive: true })
    writeFileSync(join(skills, 'SKILL.md'), '---\nname: wecomcli-shared\ndescription: x\n---\n')
    const nodeBin = join(root, process.platform === 'win32' ? 'node.exe' : 'node')
    writeFileSync(nodeBin, '')
    expect(resolveBundledWeComSkillsDir({ DSH_NODE_BINARY: nodeBin })).toBe(dirname(skills))
    const appRoot = mkdtempSync(join(tmpdir(), 'wanwei-wecom-app-root-'))
    const cwdSkills = join(appRoot, 'assets', 'wecom-skills', 'wecomcli-shared')
    mkdirSync(cwdSkills, { recursive: true })
    writeFileSync(join(cwdSkills, 'SKILL.md'), '---\nname: wecomcli-shared\ndescription: x\n---\n')
    expect(resolveBundledWeComSkillsDir({ DSH_APP_ROOT: appRoot })).toBe(dirname(cwdSkills))
    const previous = process.env.DSH_NODE_BINARY
    const previousDev = process.env.DSH_DESKTOP_DEVELOPMENT
    process.env.DSH_NODE_BINARY = nodeBin
    delete process.env.DSH_WECOM_SKILLS_DIR
    delete process.env.DSH_DESKTOP_DEVELOPMENT
    try {
      const home = mkdtempSync(join(tmpdir(), 'wanwei-wecom-home-skills-'))
      // Production sidecar layout (document-tool beside app/) without staged WeCom skills.
      const bareRoot = mkdtempSync(join(tmpdir(), 'wanwei-wecom-bare-'))
      const bareNode = join(bareRoot, process.platform === 'win32' ? 'node.exe' : 'node')
      writeFileSync(bareNode, '')
      mkdirSync(join(bareRoot, 'app'), { recursive: true })
      writeFileSync(join(bareRoot, 'app', 'document-tool.mjs'), '')
      process.env.DSH_NODE_BINARY = bareNode
      await expect(installWeComCliSkills(home)).rejects.toThrow(/安装包缺少企业微信技能资源/)
    } finally {
      if (previous === undefined) delete process.env.DSH_NODE_BINARY
      else process.env.DSH_NODE_BINARY = previous
      if (previousDev === undefined) delete process.env.DSH_DESKTOP_DEVELOPMENT
      else process.env.DSH_DESKTOP_DEVELOPMENT = previousDev
    }
  })

  it('reports missing wecom-cli when the CLI is absent from the bundle and PATH', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wecom-'))
    process.env.DSH_HOME = home
    process.env.PATH = ''
    process.env.Path = ''
    delete process.env.DSH_WECOM_CLI
    delete process.env.DSH_NODE_BINARY
    delete process.env.DSH_BUNDLE_ANCHORS
    // Force PATH-only miss; bundled resolution may still hit a workspace install.
    const status = await buildWeComCliStatus(home)
    if (resolveWeComCliCommand() === undefined) {
      expect(status.cliInstalled).toBe(false)
      expect(status.authed).toBe(false)
      expect(status.hint).toMatch(/wecom-cli/)
    } else {
      expect(status.cliInstalled).toBe(true)
    }
  })

  it('reuses a short-lived status cache until invalidated', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wecom-cache-'))
    process.env.DSH_HOME = home
    process.env.PATH = ''
    process.env.Path = ''
    const first = await buildWeComCliStatus(home)
    const second = await buildWeComCliStatus(home)
    expect(second).toBe(first)
    invalidateWeComCliStatusCache()
    const third = await buildWeComCliStatus(home, { fresh: true })
    expect(third).not.toBe(first)
    expect(third.cliInstalled).toBe(first.cliInstalled)
  })

  it('disconnect removes wecomcli skill directories', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wecom-home-'))
    process.env.PATH = ''
    process.env.Path = ''
    process.env.WECOM_CLI_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'wanwei-wecom-cfg-'))
    const dest = wecomSharedSkillDir(home)
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'SKILL.md'), '---\nname: wecomcli-shared\ndescription: x\n---\n')
    expect(existsSync(join(dest, 'SKILL.md'))).toBe(true)
    const after = await disconnectWeComCli(home)
    expect(existsSync(join(dest, 'SKILL.md'))).toBe(false)
    expect(after.skillInstalled).toBe(false)
  })

  it('returns from unbind before a hanging wecom-cli can answer', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wecom-async-'))
    const cliDir = mkdtempSync(join(tmpdir(), 'wanwei-wecom-fake-'))
    const node = process.execPath.replace(/"/g, '')
    const marker = join(cliDir, 'spawned')
    const script = join(cliDir, 'fake-wecom.mjs')
    writeFileSync(script, `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'spawned')\nprocess.exit(0)\n`)
    const command = process.platform === 'win32' ? join(cliDir, 'wecom-cli.cmd') : join(cliDir, 'wecom-cli')
    if (process.platform === 'win32') {
      writeFileSync(command, `@echo off\r\n"${node}" "%~dp0fake-wecom.mjs" %*\r\n`)
    } else {
      writeFileSync(command, `#!/bin/sh\nexec "${node}" "$(dirname "$0")/fake-wecom.mjs" "$@"\n`)
      const { chmodSync } = await import('node:fs')
      chmodSync(command, 0o755)
    }
    process.env.DSH_HOME = home
    process.env.DSH_WECOM_CLI = command
    process.env.PATH = ''
    process.env.Path = ''
    process.env.WECOM_CLI_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'wanwei-wecom-cfg-'))
    const dest = wecomSharedSkillDir(home)
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'SKILL.md'), '---\nname: wecomcli-shared\ndescription: x\n---\n')
    const started = Date.now()
    const after = await disconnectWeComCli(home)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(after.skillInstalled).toBe(false)
    expect(after.authed).toBe(false)
    expect(after.cliInstalled).toBe(true)
    expect(existsSync(marker)).toBe(false)
  })

  it('returns from connect and a later connect before wecom-cli finishes', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wecom-login-'))
    const cliDir = mkdtempSync(join(tmpdir(), 'wanwei-wecom-login-cli-'))
    const node = process.execPath.replace(/"/g, '')
    const script = join(cliDir, 'fake-wecom.mjs')
    writeFileSync(script, [
      'const args = process.argv.slice(2)',
      'const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))',
      'if (args[0] === "auth" && args[1] === "show") {',
      '  console.log("unauthorized")',
      '  process.exit(0)',
      '}',
      'if (args[0] === "auth" && args[1] === "init") {',
      '  await delay(800)',
      '  process.exit(0)',
      '}',
      'process.exit(0)',
      '',
    ].join('\n'))
    const command = process.platform === 'win32' ? join(cliDir, 'wecom-cli.cmd') : join(cliDir, 'wecom-cli')
    if (process.platform === 'win32') {
      writeFileSync(command, `@echo off\r\n"${node}" "%~dp0fake-wecom.mjs" %*\r\n`)
    } else {
      writeFileSync(command, `#!/bin/sh\nexec "${node}" "$(dirname "$0")/fake-wecom.mjs" "$@"\n`)
      const { chmodSync } = await import('node:fs')
      chmodSync(command, 0o755)
    }
    process.env.DSH_HOME = home
    process.env.DSH_WECOM_CLI = command
    process.env.PATH = ''
    process.env.Path = ''
    process.env.WECOM_CLI_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'wanwei-wecom-login-cfg-'))
    const started = Date.now()
    const pending = await runWeComCliLogin(home)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(pending.authorizing).toBe(true)
    expect(pending.authed).toBe(false)
    const unbound = await disconnectWeComCli(home)
    expect(unbound.authed).toBe(false)
    expect(unbound.skillInstalled).toBe(false)
    const again = Date.now()
    const second = await runWeComCliLogin(home)
    expect(Date.now() - again).toBeLessThan(1000)
    expect(second.authorizing).toBe(true)
    cancelWeComCliLoginFlight()
  })

  it('starts auth init without auth show and leaves the waiting state when init exits', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wecom-init-'))
    const cliDir = mkdtempSync(join(tmpdir(), 'wanwei-wecom-init-cli-'))
    const showFile = join(cliDir, 'show')
    const initFile = join(cliDir, 'init')
    installFakeWeCom(cliDir, [
      "import { writeFileSync } from 'node:fs'",
      `const showFile = ${JSON.stringify(showFile)}`,
      `const initFile = ${JSON.stringify(initFile)}`,
      'const args = process.argv.slice(2)',
      'const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))',
      'if (args[0] === "auth" && args[1] === "show") {',
      '  writeFileSync(showFile, "1")',
      '  await delay(30000)',
      '  process.exit(0)',
      '}',
      'if (args[0] === "auth" && args[1] === "init") {',
      '  writeFileSync(initFile, "1")',
      '  process.exit(0)',
      '}',
      'process.exit(0)',
      '',
    ].join('\n'))
    process.env.DSH_HOME = home
    process.env.WECOM_CLI_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'wanwei-wecom-init-cfg-'))
    const dest = wecomSharedSkillDir(home)
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'SKILL.md'), '---\nname: wecomcli-shared\ndescription: x\n---\n')
    const pending = await runWeComCliLogin(home)
    expect(pending.authorizing).toBe(true)
    await vi.waitFor(async () => {
      const status = await buildWeComCliStatus(home)
      expect(status.authorizing).toBe(false)
      expect(status.authed).toBe(true)
      expect(status.skillInstalled).toBe(true)
    }, { timeout: 8_000 })
    expect(existsSync(showFile)).toBe(false)
    expect(existsSync(initFile)).toBe(true)
  })

  it('leaves the waiting state when QR credentials land before auth init exits', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wecom-credential-'))
    const cliDir = mkdtempSync(join(tmpdir(), 'wanwei-wecom-credential-cli-'))
    const stopFile = join(cliDir, 'stop')
    const exitFile = join(cliDir, 'exited')
    installFakeWeCom(cliDir, [
      "import { existsSync, mkdirSync, writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      `const stopFile = ${JSON.stringify(stopFile)}`,
      `const exitFile = ${JSON.stringify(exitFile)}`,
      'const args = process.argv.slice(2)',
      'const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))',
      'if (args[0] === "auth" && args[1] === "init") {',
      '  const dir = process.env.WECOM_CLI_CONFIG_DIR',
      '  mkdirSync(dir, { recursive: true })',
      '  await delay(600)',
      '  writeFileSync(join(dir, "credentials.enc"), "encrypted")',
      '  for (let i = 0; i < 200 && !existsSync(stopFile); i += 1) await delay(100)',
      '  writeFileSync(exitFile, "1")',
      '  process.exit(0)',
      '}',
      'process.exit(0)',
      '',
    ].join('\n'))
    process.env.DSH_HOME = home
    process.env.WECOM_CLI_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'wanwei-wecom-credential-cfg-'))
    const dest = wecomSharedSkillDir(home)
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'SKILL.md'), '---\nname: wecomcli-shared\ndescription: x\n---\n')
    const pending = await runWeComCliLogin(home)
    expect(pending.authorizing).toBe(true)
    await vi.waitFor(async () => {
      const status = await buildWeComCliStatus(home)
      expect(status.authorizing).toBe(false)
      expect(status.authed).toBe(true)
      expect(status.skillInstalled).toBe(true)
    }, { timeout: 8_000 })
    expect(existsSync(exitFile)).toBe(false)
    writeFileSync(stopFile, '1')
    await vi.waitFor(() => {
      expect(existsSync(exitFile)).toBe(true)
    }, { timeout: 8_000 })
  }, 15_000)

  it('starts auth init while an auth show probe is still running', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wecom-show-block-'))
    const cliDir = mkdtempSync(join(tmpdir(), 'wanwei-wecom-show-block-cli-'))
    const showFile = join(cliDir, 'show')
    const initFile = join(cliDir, 'init')
    const stopFile = join(cliDir, 'stop')
    installFakeWeCom(cliDir, [
      "import { existsSync, writeFileSync } from 'node:fs'",
      `const showFile = ${JSON.stringify(showFile)}`,
      `const initFile = ${JSON.stringify(initFile)}`,
      `const stopFile = ${JSON.stringify(stopFile)}`,
      'const args = process.argv.slice(2)',
      'const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))',
      'if (args[0] === "auth" && args[1] === "show") {',
      '  writeFileSync(showFile, "1")',
      '  for (let i = 0; i < 300 && !existsSync(stopFile); i += 1) await delay(100)',
      '  process.exit(0)',
      '}',
      'if (args[0] === "auth" && args[1] === "init") {',
      '  writeFileSync(initFile, "1")',
      '  process.exit(0)',
      '}',
      'process.exit(0)',
      '',
    ].join('\n'))
    process.env.DSH_HOME = home
    process.env.WECOM_CLI_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'wanwei-wecom-show-block-cfg-'))
    const dest = wecomSharedSkillDir(home)
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'SKILL.md'), '---\nname: wecomcli-shared\ndescription: x\n---\n')
    const statusPromise = buildWeComCliStatus(home)
    await vi.waitFor(() => {
      expect(existsSync(showFile)).toBe(true)
    })
    const pending = await runWeComCliLogin(home)
    expect(pending.authorizing).toBe(true)
    await vi.waitFor(() => {
      expect(existsSync(initFile)).toBe(true)
    }, { timeout: 8_000 })
    writeFileSync(stopFile, '1')
    await statusPromise
    cancelWeComCliLoginFlight()
  }, 15_000)

  it('starts auth init even when the config directory already has files', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wecom-have-cred-'))
    const cliDir = mkdtempSync(join(tmpdir(), 'wanwei-wecom-have-cred-cli-'))
    const initFile = join(cliDir, 'init')
    installFakeWeCom(cliDir, [
      "import { writeFileSync } from 'node:fs'",
      `const initFile = ${JSON.stringify(initFile)}`,
      'const args = process.argv.slice(2)',
      'if (args[0] === "auth" && args[1] === "init") {',
      '  writeFileSync(initFile, "1")',
      '  process.exit(0)',
      '}',
      'process.exit(0)',
      '',
    ].join('\n'))
    process.env.DSH_HOME = home
    const cfg = mkdtempSync(join(tmpdir(), 'wanwei-wecom-have-cred-cfg-'))
    process.env.WECOM_CLI_CONFIG_DIR = cfg
    writeFileSync(join(cfg, 'bot.json'), '{}')
    const dest = wecomSharedSkillDir(home)
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'SKILL.md'), '---\nname: wecomcli-shared\ndescription: x\n---\n')
    const pending = await runWeComCliLogin(home)
    expect(pending.authorizing).toBe(true)
    await vi.waitFor(async () => {
      const status = await buildWeComCliStatus(home)
      expect(status.authorizing).toBe(false)
      expect(status.authed).toBe(true)
    }, { timeout: 8_000 })
    expect(existsSync(initFile)).toBe(true)
  }, 15_000)

  it('clears authorizing when the skill copy fails after credentials exist', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wecom-skill-fail-'))
    const cliDir = mkdtempSync(join(tmpdir(), 'wanwei-wecom-skill-fail-cli-'))
    const staged = join(home, 'staged-skills')
    mkdirSync(join(staged, 'wecomcli-shared'), { recursive: true })
    writeFileSync(join(staged, 'wecomcli-shared', 'SKILL.md'), '---\nname: wecomcli-shared\n---\n')
    installFakeWeCom(cliDir, [
      'const args = process.argv.slice(2)',
      'if (args[0] === "auth" && args[1] === "init") process.exit(0)',
      'process.exit(0)',
      '',
    ].join('\n'))
    process.env.DSH_HOME = home
    process.env.DSH_WECOM_SKILLS_DIR = staged
    process.env.WECOM_CLI_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'wanwei-wecom-skill-fail-cfg-'))
    writeFileSync(join(home, 'skills'), 'not-a-directory')
    await runWeComCliLogin(home)
    await vi.waitFor(async () => {
      const status = await buildWeComCliStatus(home)
      expect(status.authorizing).toBe(false)
      expect(status.authorizeError && status.authorizeError.length > 0).toBe(true)
    }, { timeout: 8_000 })
  }, 15_000)

  it('reports the CLI error when auth init exits non-zero', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wecom-init-fail-'))
    const cliDir = mkdtempSync(join(tmpdir(), 'wanwei-wecom-init-fail-cli-'))
    installFakeWeCom(cliDir, [
      'const args = process.argv.slice(2)',
      'if (args[0] === "auth" && args[1] === "init") {',
      '  console.error("qr failed")',
      '  process.exit(2)',
      '}',
      'process.exit(0)',
      '',
    ].join('\n'))
    process.env.DSH_HOME = home
    process.env.WECOM_CLI_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'wanwei-wecom-init-fail-cfg-'))
    await runWeComCliLogin(home)
    await vi.waitFor(async () => {
      const status = await buildWeComCliStatus(home)
      expect(status.authorizing).toBe(false)
      expect(status.authorizeError).toMatch(/qr failed/)
    }, { timeout: 8_000 })
  }, 15_000)

  it('reports a generic failure when auth init exits non-zero with no output', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wecom-init-empty-'))
    const cliDir = mkdtempSync(join(tmpdir(), 'wanwei-wecom-init-empty-cli-'))
    installFakeWeCom(cliDir, [
      'const args = process.argv.slice(2)',
      'if (args[0] === "auth" && args[1] === "init") process.exit(2)',
      'process.exit(0)',
      '',
    ].join('\n'))
    process.env.DSH_HOME = home
    process.env.WECOM_CLI_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'wanwei-wecom-init-empty-cfg-'))
    await runWeComCliLogin(home)
    await vi.waitFor(async () => {
      const status = await buildWeComCliStatus(home)
      expect(status.authorizing).toBe(false)
      expect(status.authorizeError).toMatch(/未成功完成/)
    }, { timeout: 8_000 })
  }, 15_000)

  it('reports a start failure when wecom-cli cannot be spawned', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wecom-spawn-fail-'))
    const cli = join(home, 'wecom-dir')
    mkdirSync(cli)
    process.env.DSH_HOME = home
    process.env.DSH_WECOM_CLI = cli
    process.env.PATH = ''
    process.env.Path = ''
    process.env.WECOM_CLI_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'wanwei-wecom-spawn-cfg-'))
    await runWeComCliLogin(home)
    await vi.waitFor(async () => {
      const status = await buildWeComCliStatus(home)
      expect(status.authorizing).toBe(false)
      expect(status.authorizeError).toMatch(/未能启动/)
    }, { timeout: 8_000 })
  }, 15_000)

  it('status payloads include authorizing flags and cancel clears a flight', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wecom-auth-flags-'))
    process.env.DSH_HOME = home
    process.env.PATH = ''
    process.env.Path = ''
    const status = await buildWeComCliStatus(home)
    expect(status.authorizing).toBe(false)
    expect(status.authorizeError).toBe(null)
    expect(() => cancelWeComCliLoginFlight()).not.toThrow()
    expect((await buildWeComCliStatus(home)).authorizing).toBe(false)
  })
})

describe('WeCom CLI RPC', () => {
  it('exports plugin metadata and mounts status RPC', async () => {
    expect(name).toBe('wanwei-connectors')
    expect(inject).toEqual([
      'connection',
      'sessionController',
      'sessions',
      'agents',
      'workspaceRegistry',
      'permissionPresets',
    ])
    const handlers = new Map<string, (endpoint: string, payload: unknown) => Promise<unknown>>()
    const home = mkdtempSync(join(tmpdir(), 'wanwei-wecom-rpc-'))
    process.env.DSH_HOME = home
    process.env.PATH = ''
    process.env.Path = ''
    // Stub the CLI so status cannot hang on a real wecom-cli from the workspace install.
    const stub = join(home, process.platform === 'win32' ? 'wecom-cli.cmd' : 'wecom-cli')
    writeFileSync(stub, process.platform === 'win32'
      ? '@echo unauthorized\r\nexit /b 1\r\n'
      : '#!/bin/sh\necho unauthorized\nexit 1\n')
    process.env.DSH_WECOM_CLI = stub
    invalidateWeComCliStatusCache()
    const ctx = new Context()
    Object.assign(ctx, {
      get(key: string) {
        if (key === 'connection') {
          return {
            rpc: {
              handle: (channel: string, handler: (endpoint: string, payload: unknown) => Promise<unknown>) => {
                handlers.set(channel, handler)
                return async () => undefined
              },
            },
          }
        }
        return undefined
      },
      effect(fn: () => () => void | Promise<void>) {
        return fn()
      },
    })
    apply(ctx as Context)
    expect(handlers.has('/wanwei-wecom')).toBe(true)
    const result = await handlers.get('/wanwei-wecom')!('status', {}) as {
      ok: true
      value: { cliInstalled: boolean; authed: boolean; skillInstalled: boolean }
    }
    expect(result.ok).toBe(true)
    expect(typeof result.value.cliInstalled).toBe('boolean')
    expect(typeof result.value.authed).toBe('boolean')
    expect(typeof result.value.skillInstalled).toBe('boolean')

    registerWeComCliRpc(ctx as Context)
    const unknown = await handlers.get('/wanwei-wecom')!('nope', {}) as { ok: false }
    expect(unknown.ok).toBe(false)
  })
})
