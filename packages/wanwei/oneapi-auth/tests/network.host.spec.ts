import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installNetworkPolicy } from '../src/network.ts'
import { internalLink } from '../src/network-contract.ts'
import { OneApiSearchProvider } from '../src/search-provider.ts'

class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}
  get writable() { return true }
  protected load() { return Promise.resolve(this.doc) }
  protected persist(ns: SettingsNamespace, section: Record<string, unknown>) {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}
afterEach(() => { vi.unstubAllGlobals() })

describe('Wanwei network policy', () => {
  it('retains local/platform skills, rejects cached SkillHub loads and restores internet tools', async () => {
    const ctx = new Context()
    const root = await mkdtemp(join(tmpdir(), 'wanwei-network-'))
    try {
      await writeFile(join(root, '.wanwei-skillhub.json'), '{}')
      await ctx.plugin(MemorySettings)
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      const search = defineTool({ name: 'web_search', description: 'search', parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { return 'ok' } })
      ctx.tools.register(search)
      ctx.skills.register({ name: 'hub-skill', description: 'hub', source: 'custom', content: 'hub body', resourceBase: { kind: 'directory', path: root } })
      ctx.skills.register({ name: 'platform-skill', description: 'platform', source: 'custom', content: 'platform body' })
      const policy = installNetworkPolicy(ctx, 'https://internal.example.com/api')
      expect(policy.getSnapshot().mode).toBe('internet')
      expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['hub-skill', 'platform-skill'])
      expect(ctx.tools.get('web_search')).toBeDefined()
      await policy.setMode('intranet')
      expect((ctx.settings as MemorySettings).doc['wanwei-network']).toEqual({ mode: 'intranet' })
      expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['platform-skill'])
      expect(await ctx.skills.get('hub-skill')).toBeUndefined()
      expect(await ctx.skills.get('platform-skill')).toBeDefined()
      expect(ctx.tools.get('web_search')).toBeUndefined()
      expect(ctx.tools.schemas()).toEqual([])
      const blockedSearch = await ctx.tools.execute({ name: 'web_search', callId: ToolCallId('blocked-search'), arguments: {}, signal: new AbortController().signal })
      expect(blockedSearch.isError).toBe(true)
      await expect(policy.setMode('invalid')).rejects.toThrow('网络环境无效')
      expect(policy.getSnapshot().mode).toBe('intranet')
      await policy.setMode('internet')
      expect(await ctx.skills.get('hub-skill')).toBeDefined()
      expect(ctx.tools.get('web_search')).toBeDefined()
      const restoredSearch = await ctx.tools.execute({ name: 'web_search', callId: ToolCallId('restored-search'), arguments: {}, signal: new AbortController().signal })
      expect(restoredSearch.isError).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects search before token resolution or network I/O in intranet mode', async () => {
    const fetcher = vi.fn()
    const token = vi.fn(async () => 'token')
    vi.stubGlobal('fetch', fetcher)
    const provider = new OneApiSearchProvider({ baseURL: 'https://internal.example.com', resolveToken: token, allowed: () => false })
    expect(provider.available()).toBe(false)
    await expect(provider.search({ query: 'test' })).rejects.toThrow('纯内网环境不可用')
    expect(token).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['http://10.0.0.2/', 'http://172.31.0.1/', 'http://192.168.1.2/', 'http://127.0.0.1/', 'http://[::1]/', 'https://server.lan/', 'http://server/', 'https://internal.example.com/path'])('allows internal link %s', (address) => {
    expect(internalLink(address, ['https://internal.example.com'])).toBe(true)
  })
  it.each(['https://docs.qq.com/', 'http://172.32.0.1/', 'https://localhost.example.com/', 'javascript:alert(1)', 'bad'])('does not classify public/invalid link %s as internal', (address) => {
    expect(internalLink(address, [])).toBe(false)
  })
})
