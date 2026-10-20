import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import {
  buildWeComCliStatus,
  cancelWeComCliLoginFlight,
  disconnectWeComCli,
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

describe('WeCom CLI Host helpers', () => {
  it('resolves config dir from WECOM_CLI_CONFIG_DIR or platform defaults', () => {
    expect(resolveWeComConfigDir({ WECOM_CLI_CONFIG_DIR: 'D:/cfg/wecom' })).toBe('D:/cfg/wecom')
    if (process.platform === 'win32') {
      expect(resolveWeComConfigDir({ APPDATA: 'D:/AppData' })).toBe(join('D:/AppData', 'wecom'))
    } else {
      expect(resolveWeComConfigDir({ HOME: '/home/u' })).toBe(join('/home/u', '.config', 'wecom'))
    }
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
