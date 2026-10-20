import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import {
  buildDingTalkDwsStatus,
  cancelDingTalkDwsLoginFlight,
  disconnectDingTalkDws,
  dwsCliSkillInstallDir,
  runDingTalkDwsLogin,
  invalidateDingTalkDwsStatusCache,
  parseDwsAuthenticated,
  registerDingTalkDwsRpc,
  resolveBundledDwsCliSkillDir,
  resolveBundledDwsCommand,
  resolveDwsCommand,
  resolveProductDshHome,
} from '../src/dingtalk-dws.ts'
import { apply, inject, name } from '../src/index.ts'

const originalPath = process.env.PATH
const originalPathWin = process.env.Path

afterEach(() => {
  cancelDingTalkDwsLoginFlight()
  vi.restoreAllMocks()
  invalidateDingTalkDwsStatusCache()
  delete process.env.DSH_HOME
  delete process.env.DSH_DWS_CLI
  delete process.env.DSH_DWS_SKILL_DIR
  delete process.env.DSH_NODE_BINARY
  delete process.env.DSH_BUNDLE_ANCHORS
  if (originalPath === undefined) delete process.env.PATH
  else process.env.PATH = originalPath
  if (originalPathWin === undefined) delete process.env.Path
  else process.env.Path = originalPathWin
})

/** Point `DSH_DWS_CLI` at a node script. The script body is ESM. */
function installFakeDws(cliDir: string, body: string): string {
  const node = process.execPath.replace(/"/g, '')
  const script = join(cliDir, 'fake-dws.mjs')
  writeFileSync(script, body)
  const command = process.platform === 'win32' ? join(cliDir, 'dws.cmd') : join(cliDir, 'dws')
  if (process.platform === 'win32') {
    writeFileSync(command, `@echo off\r\n"${node}" "%~dp0fake-dws.mjs" %*\r\n`)
  } else {
    writeFileSync(command, '#!/bin/sh\nexec "' + node + '" "$(dirname "$0")/fake-dws.mjs" "$@"\n')
    chmodSync(command, 0o755)
  }
  process.env.DSH_DWS_CLI = command
  process.env.PATH = ''
  process.env.Path = ''
  return command
}

describe('DingTalk DWS Host helpers', () => {
  it('parses dws auth status JSON without treating exit-0 as logged in', () => {
    expect(parseDwsAuthenticated(JSON.stringify({
      success: true,
      authenticated: false,
      message: '未登录',
    }))).toBe(false)
    expect(parseDwsAuthenticated(JSON.stringify({
      success: true,
      authenticated: true,
      message: '已登录',
    }))).toBe(true)
    expect(parseDwsAuthenticated([
      JSON.stringify({ version_check: { status: 'up_to_date' } }),
      JSON.stringify({ success: true, authenticated: true }),
    ].join('\n'))).toBe(true)
    expect(parseDwsAuthenticated('not-json')).toBe(false)
  })

  it('requires DSH_HOME for product skill install', () => {
    expect(() => resolveProductDshHome({})).toThrow(/DSH_HOME/)
    expect(resolveProductDshHome({ DSH_HOME: 'D:/data/dsh' })).toBe('D:/data/dsh')
  })

  it('resolves bundled dws-cli skill from the desktop product install', () => {
    const skill = resolveBundledDwsCliSkillDir()
    // Present when @dingtalk-real-ai/dsh-dingtalk is installed under products/wanwei-desktop.
    if (skill !== undefined) {
      expect(existsSync(join(skill, 'SKILL.md'))).toBe(true)
    }
  })

  it('prefers DSH_DWS_CLI and a staged runtime binary over PATH', () => {
    const root = mkdtempSync(join(tmpdir(), 'wanwei-dws-bundle-'))
    const binaryName = process.platform === 'win32' ? 'dws.exe' : 'dws'
    const binary = join(root, 'app', 'node_modules', 'dingtalk-workspace-cli', 'vendor', binaryName)
    mkdirSync(dirname(binary), { recursive: true })
    writeFileSync(binary, '')
    const nodeBin = join(root, process.platform === 'win32' ? 'node.exe' : 'node')
    writeFileSync(nodeBin, '')
    expect(resolveBundledDwsCommand({ DSH_NODE_BINARY: nodeBin })).toBe(binary)
    const override = join(root, 'custom-dws')
    writeFileSync(override, '')
    expect(resolveBundledDwsCommand({ DSH_DWS_CLI: override })).toBe(override)
  })

  it('resolves staged dws-cli skill assets beside DSH_NODE_BINARY', () => {
    const root = mkdtempSync(join(tmpdir(), 'wanwei-dws-skill-'))
    const skill = join(root, 'app', 'assets', 'dws-cli')
    mkdirSync(skill, { recursive: true })
    writeFileSync(join(skill, 'SKILL.md'), '---\nname: dws-cli\ndescription: x\n---\n')
    const nodeBin = join(root, process.platform === 'win32' ? 'node.exe' : 'node')
    writeFileSync(nodeBin, '')
    expect(resolveBundledDwsCliSkillDir({ DSH_NODE_BINARY: nodeBin })).toBe(skill)
  })

  it('resolves staged dws-cli skill assets from DSH_APP_ROOT / cwd', () => {
    const root = mkdtempSync(join(tmpdir(), 'wanwei-dws-app-root-'))
    const skill = join(root, 'assets', 'dws-cli')
    mkdirSync(skill, { recursive: true })
    writeFileSync(join(skill, 'SKILL.md'), '---\nname: dws-cli\ndescription: x\n---\n')
    expect(resolveBundledDwsCliSkillDir({ DSH_APP_ROOT: root })).toBe(skill)
  })

  it('replaces an empty dws-cli destination when installing the skill', async () => {
    const { installDwsCliSkill } = await import('../src/dingtalk-dws.ts')
    const home = mkdtempSync(join(tmpdir(), 'wanwei-dws-empty-dest-'))
    const dest = join(home, 'skills', 'dws-cli')
    mkdirSync(dest, { recursive: true })
    const source = mkdtempSync(join(tmpdir(), 'wanwei-dws-src-'))
    writeFileSync(join(source, 'SKILL.md'), '---\nname: dws-cli\ndescription: x\n---\n')
    const previous = process.env.DSH_DWS_SKILL_DIR
    process.env.DSH_DWS_SKILL_DIR = source
    try {
      expect(installDwsCliSkill(home)).toBe(dest)
      expect(existsSync(join(dest, 'SKILL.md'))).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.DSH_DWS_SKILL_DIR
      else process.env.DSH_DWS_SKILL_DIR = previous
    }
  })

  it('reports missing dws when the CLI is absent from the bundle and PATH', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-dws-'))
    process.env.DSH_HOME = home
    process.env.PATH = ''
    process.env.Path = ''
    const status = await buildDingTalkDwsStatus(home)
    if (resolveDwsCommand() === undefined) {
      expect(status.dwsInstalled).toBe(false)
      expect(status.authed).toBe(false)
      expect(status.hint).toMatch(/dws/)
    } else {
      expect(status.dwsInstalled).toBe(true)
    }
  })

  it('reuses a short-lived status cache until invalidated', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-dws-cache-'))
    process.env.DSH_HOME = home
    process.env.PATH = ''
    process.env.Path = ''
    const first = await buildDingTalkDwsStatus(home)
    const second = await buildDingTalkDwsStatus(home)
    expect(second).toBe(first)
    invalidateDingTalkDwsStatusCache()
    const third = await buildDingTalkDwsStatus(home, { fresh: true })
    expect(third).not.toBe(first)
    expect(third.dwsInstalled).toBe(first.dwsInstalled)
  })

  it('disconnect removes the installed skill directory', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-dws-home-'))
    // Avoid calling a real `dws auth logout` during unit tests.
    process.env.PATH = ''
    process.env.Path = ''
    const dest = dwsCliSkillInstallDir(home)
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'SKILL.md'), '---\nname: dws-cli\ndescription: x\n---\n')
    expect(existsSync(join(dest, 'SKILL.md'))).toBe(true)
    const after = await disconnectDingTalkDws(home)
    expect(existsSync(join(dest, 'SKILL.md'))).toBe(false)
    expect(after.skillInstalled).toBe(false)
  })

  it('returns from connect and unbind before the CLI process finishes', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-dws-async-'))
    const cliDir = mkdtempSync(join(tmpdir(), 'wanwei-dws-fake-'))
    const node = process.execPath.replace(/"/g, '')
    const script = join(cliDir, 'fake-dws.mjs')
    writeFileSync(script, [
      'const args = process.argv.slice(2)',
      'const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))',
      'if (args[0] === "auth" && args[1] === "status") {',
      '  console.log(JSON.stringify({ authenticated: false }))',
      '  process.exit(0)',
      '}',
      'if (args[0] === "auth" && args[1] === "login") {',
      '  await delay(800)',
      '  process.exit(0)',
      '}',
      'process.exit(0)',
      '',
    ].join('\n'))
    const command = process.platform === 'win32' ? join(cliDir, 'dws.cmd') : join(cliDir, 'dws')
    if (process.platform === 'win32') {
      writeFileSync(command, `@echo off\r\n"${node}" "%~dp0fake-dws.mjs" %*\r\n`)
    } else {
      writeFileSync(command, `#!/bin/sh\nexec "${node}" "$(dirname "$0")/fake-dws.mjs" "$@"\n`)
      const { chmodSync } = await import('node:fs')
      chmodSync(command, 0o755)
    }
    process.env.DSH_HOME = home
    process.env.DSH_DWS_CLI = command
    process.env.PATH = ''
    process.env.Path = ''
    const started = Date.now()
    const pending = await runDingTalkDwsLogin(home)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(pending.authorizing).toBe(true)
    const dest = dwsCliSkillInstallDir(home)
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'SKILL.md'), '---\nname: dws-cli\ndescription: x\n---\n')
    const unbound = await disconnectDingTalkDws(home)
    expect(unbound.skillInstalled).toBe(false)
    expect(unbound.authed).toBe(false)
    await vi.waitFor(async () => {
      const status = await buildDingTalkDwsStatus(home)
      expect(status.authorizing).toBe(false)
    })
  })

  it('leaves the waiting state when readonly status shows a saved login before dws auth login exits', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-dws-readonly-'))
    const cliDir = mkdtempSync(join(tmpdir(), 'wanwei-dws-readonly-cli-'))
    const countFile = join(cliDir, 'count.txt')
    const exitFile = join(cliDir, 'exited')
    const stopFile = join(cliDir, 'stop')
    installFakeDws(cliDir, [
      "import { existsSync, readFileSync, writeFileSync } from 'node:fs'",
      `const countFile = ${JSON.stringify(countFile)}`,
      `const exitFile = ${JSON.stringify(exitFile)}`,
      `const stopFile = ${JSON.stringify(stopFile)}`,
      'const args = process.argv.slice(2)',
      'const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))',
      'if (args[0] === "auth" && args[1] === "status") {',
      '  let n = 0',
      '  try { n = Number(readFileSync(countFile, "utf8")) } catch {}',
      '  writeFileSync(countFile, String(n + 1))',
      '  console.log(JSON.stringify({ authenticated: n >= 1 }))',
      '  process.exit(0)',
      '}',
      'if (args[0] === "auth" && args[1] === "login") {',
      '  for (let i = 0; i < 200 && !existsSync(stopFile); i += 1) await delay(100)',
      '  writeFileSync(exitFile, "1")',
      '  process.exit(0)',
      '}',
      'process.exit(0)',
      '',
    ].join('\n'))
    process.env.DSH_HOME = home
    const dest = dwsCliSkillInstallDir(home)
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'SKILL.md'), '---\nname: dws-cli\ndescription: x\n---\n')
    const pending = await runDingTalkDwsLogin(home)
    expect(pending.authorizing).toBe(true)
    await vi.waitFor(async () => {
      const status = await buildDingTalkDwsStatus(home)
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

  it('releases the CLI queue when a browser inherits login output pipes', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-dws-pipe-reconnect-'))
    const cliDir = mkdtempSync(join(tmpdir(), 'wanwei-dws-pipe-reconnect-cli-'))
    const authFile = join(cliDir, 'authed')
    const countFile = join(cliDir, 'login-count')
    const stopFile = join(cliDir, 'stop-holders')
    const holder = join(cliDir, 'holder.mjs')
    writeFileSync(holder, [
      "import { existsSync } from 'node:fs'",
      'const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))',
      `while (!existsSync(${JSON.stringify(stopFile)})) await delay(100)`,
      '',
    ].join('\n'))
    installFakeDws(cliDir, [
      "import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'",
      "import { spawn } from 'node:child_process'",
      `const authFile = ${JSON.stringify(authFile)}`,
      `const countFile = ${JSON.stringify(countFile)}`,
      `const holder = ${JSON.stringify(holder)}`,
      'const args = process.argv.slice(2)',
      'if (args[0] === "auth" && args[1] === "status") {',
      '  console.log(JSON.stringify({ authenticated: existsSync(authFile) }))',
      '  process.exit(0)',
      '}',
      'if (args[0] === "auth" && args[1] === "login") {',
      '  let count = 0',
      '  try { count = Number(readFileSync(countFile, "utf8")) } catch {}',
      '  writeFileSync(countFile, String(count + 1))',
      '  writeFileSync(authFile, "1")',
      '  const browser = spawn(process.execPath, [holder], {',
      '    detached: true,',
      '    stdio: ["ignore", process.stdout, process.stderr],',
      '  })',
      '  browser.unref()',
      '  process.exit(0)',
      '}',
      'if (args[0] === "auth" && (args[1] === "logout" || args[1] === "reset")) {',
      '  rmSync(authFile, { force: true })',
      '  process.exit(0)',
      '}',
      'process.exit(0)',
      '',
    ].join('\n'))
    process.env.DSH_HOME = home
    const staged = join(cliDir, 'dws-cli')
    mkdirSync(staged)
    writeFileSync(join(staged, 'SKILL.md'), '---\nname: dws-cli\ndescription: x\n---\n')
    process.env.DSH_DWS_SKILL_DIR = staged

    await runDingTalkDwsLogin(home)
    await vi.waitFor(async () => {
      expect((await buildDingTalkDwsStatus(home)).authed).toBe(true)
    }, { timeout: 8_000 })

    await disconnectDingTalkDws(home)
    await runDingTalkDwsLogin(home)
    await vi.waitFor(async () => {
      const status = await buildDingTalkDwsStatus(home)
      expect(status.authorizing).toBe(false)
      expect(status.authed).toBe(true)
      expect(status.skillInstalled).toBe(true)
      expect(readFileSync(countFile, 'utf8')).toBe('2')
    }, { timeout: 12_000 })

    writeFileSync(stopFile, '1')
  }, 20_000)

  it('installs the skill from a readonly login without waiting for dws auth login to exit', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-dws-readonly-now-'))
    const cliDir = mkdtempSync(join(tmpdir(), 'wanwei-dws-readonly-now-cli-'))
    const loginFile = join(cliDir, 'login-started')
    installFakeDws(cliDir, [
      "import { writeFileSync } from 'node:fs'",
      `const loginFile = ${JSON.stringify(loginFile)}`,
      'const args = process.argv.slice(2)',
      'if (args[0] === "auth" && args[1] === "status") {',
      '  console.log(JSON.stringify({ authenticated: true }))',
      '  process.exit(0)',
      '}',
      'if (args[0] === "auth" && args[1] === "login") {',
      '  writeFileSync(loginFile, "1")',
      '  process.exit(0)',
      '}',
      'process.exit(0)',
      '',
    ].join('\n'))
    process.env.DSH_HOME = home
    const pending = await runDingTalkDwsLogin(home)
    expect(pending.authorizing).toBe(true)
    await vi.waitFor(async () => {
      const status = await buildDingTalkDwsStatus(home)
      expect(status.authorizing).toBe(false)
      expect(status.authed).toBe(true)
      expect(status.skillInstalled).toBe(true)
    }, { timeout: 8_000 })
    expect(existsSync(loginFile)).toBe(false)
  }, 15_000)

  it('clears authorizing when the skill copy fails after a saved login', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-dws-skill-fail-'))
    const cliDir = mkdtempSync(join(tmpdir(), 'wanwei-dws-skill-fail-cli-'))
    installFakeDws(cliDir, [
      'const args = process.argv.slice(2)',
      'if (args[0] === "auth" && args[1] === "status") {',
      '  console.log(JSON.stringify({ authenticated: true }))',
      '  process.exit(0)',
      '}',
      'process.exit(0)',
      '',
    ].join('\n'))
    process.env.DSH_HOME = home
    writeFileSync(join(home, 'skills'), 'not-a-directory')
    const pending = await runDingTalkDwsLogin(home)
    expect(pending.authorizing).toBe(true)
    await vi.waitFor(async () => {
      const status = await buildDingTalkDwsStatus(home)
      expect(status.authorizing).toBe(false)
      expect(status.authorizeError && status.authorizeError.length > 0).toBe(true)
    }, { timeout: 8_000 })
  }, 15_000)

  it('reports authorizeError when login exits before a saved login exists', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-dws-exit-early-'))
    const cliDir = mkdtempSync(join(tmpdir(), 'wanwei-dws-exit-early-cli-'))
    installFakeDws(cliDir, [
      'const args = process.argv.slice(2)',
      'if (args[0] === "auth" && args[1] === "status") {',
      '  console.log(JSON.stringify({ authenticated: false }))',
      '  process.exit(0)',
      '}',
      'if (args[0] === "auth" && args[1] === "login") process.exit(0)',
      'process.exit(0)',
      '',
    ].join('\n'))
    process.env.DSH_HOME = home
    await runDingTalkDwsLogin(home)
    await vi.waitFor(async () => {
      const status = await buildDingTalkDwsStatus(home)
      expect(status.authorizing).toBe(false)
      expect(status.authorizeError).toMatch(/尚未生效/)
    }, { timeout: 8_000 })
  }, 15_000)

  it('reports the CLI error when dws auth login exits non-zero', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-dws-exit-fail-'))
    const cliDir = mkdtempSync(join(tmpdir(), 'wanwei-dws-exit-fail-cli-'))
    installFakeDws(cliDir, [
      'const args = process.argv.slice(2)',
      'if (args[0] === "auth" && args[1] === "status") {',
      '  console.log(JSON.stringify({ authenticated: false }))',
      '  process.exit(0)',
      '}',
      'if (args[0] === "auth" && args[1] === "login") {',
      '  console.error("denied")',
      '  process.exit(2)',
      '}',
      'process.exit(0)',
      '',
    ].join('\n'))
    process.env.DSH_HOME = home
    await runDingTalkDwsLogin(home)
    await vi.waitFor(async () => {
      const status = await buildDingTalkDwsStatus(home)
      expect(status.authorizeError).toMatch(/denied/)
      expect(status.authorizing).toBe(false)
    }, { timeout: 8_000 })
  }, 15_000)

  it('reports a generic failure when dws auth login exits non-zero with no output', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-dws-exit-empty-'))
    const cliDir = mkdtempSync(join(tmpdir(), 'wanwei-dws-exit-empty-cli-'))
    installFakeDws(cliDir, [
      'const args = process.argv.slice(2)',
      'if (args[0] === "auth" && args[1] === "status") {',
      '  console.log(JSON.stringify({ authenticated: false }))',
      '  process.exit(0)',
      '}',
      'if (args[0] === "auth" && args[1] === "login") process.exit(3)',
      'process.exit(0)',
      '',
    ].join('\n'))
    process.env.DSH_HOME = home
    await runDingTalkDwsLogin(home)
    await vi.waitFor(async () => {
      const status = await buildDingTalkDwsStatus(home)
      expect(status.authorizeError).toMatch(/未成功完成/)
    }, { timeout: 8_000 })
  }, 15_000)

  it('reports a start failure when dws cannot be spawned', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-dws-spawn-fail-'))
    const cli = join(home, 'dws-dir')
    mkdirSync(cli)
    process.env.DSH_HOME = home
    process.env.DSH_DWS_CLI = cli
    process.env.PATH = ''
    process.env.Path = ''
    await runDingTalkDwsLogin(home)
    await vi.waitFor(async () => {
      const status = await buildDingTalkDwsStatus(home)
      expect(status.authorizing).toBe(false)
      expect(status.authorizeError).toMatch(/未能启动/)
    }, { timeout: 8_000 })
  }, 15_000)

  it('status payloads include authorizing flags and cancel clears a flight', async () => {
    const home = mkdtempSync(join(tmpdir(), 'wanwei-dws-auth-flags-'))
    process.env.DSH_HOME = home
    process.env.PATH = ''
    process.env.Path = ''
    const status = await buildDingTalkDwsStatus(home)
    expect(status.authorizing).toBe(false)
    expect(status.authorizeError).toBe(null)
    expect(() => cancelDingTalkDwsLoginFlight()).not.toThrow()
    expect((await buildDingTalkDwsStatus(home)).authorizing).toBe(false)
  })
})

describe('DingTalk DWS RPC', () => {
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
    const home = mkdtempSync(join(tmpdir(), 'wanwei-dws-rpc-'))
    process.env.DSH_HOME = home
    process.env.PATH = ''
    process.env.Path = ''
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
    expect(handlers.has('/wanwei-dingtalk')).toBe(true)
    const result = await handlers.get('/wanwei-dingtalk')!('status', {}) as {
      ok: true
      value: { dwsInstalled: boolean; authed: boolean; skillInstalled: boolean }
    }
    expect(result.ok).toBe(true)
    expect(typeof result.value.dwsInstalled).toBe('boolean')
    expect(typeof result.value.authed).toBe('boolean')
    expect(typeof result.value.skillInstalled).toBe('boolean')
    expect(result.value).toMatchObject({ authorizing: false, authorizeError: null })

    registerDingTalkDwsRpc(ctx as Context)
    const unknown = await handlers.get('/wanwei-dingtalk')!('nope', {}) as { ok: false }
    expect(unknown.ok).toBe(false)
  })
})
