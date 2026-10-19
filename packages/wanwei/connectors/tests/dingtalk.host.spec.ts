import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import {
  buildDingTalkDwsStatus,
  disconnectDingTalkDws,
  dwsCliSkillInstallDir,
  invalidateDingTalkDwsStatusCache,
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
  vi.restoreAllMocks()
  invalidateDingTalkDwsStatusCache()
  delete process.env.DSH_HOME
  delete process.env.DSH_DWS_CLI
  delete process.env.DSH_NODE_BINARY
  delete process.env.DSH_BUNDLE_ANCHORS
  if (originalPath === undefined) delete process.env.PATH
  else process.env.PATH = originalPath
  if (originalPathWin === undefined) delete process.env.Path
  else process.env.Path = originalPathWin
})

describe('DingTalk DWS Host helpers', () => {
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

    registerDingTalkDwsRpc(ctx as Context)
    const unknown = await handlers.get('/wanwei-dingtalk')!('nope', {}) as { ok: false }
    expect(unknown.ok).toBe(false)
  })
})
