// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply as applySkill, inject as skillInject } from '../packages/client/ui-skill/src/client/index.ts'
import { registerNativeSkillCatalogBridge } from '../packages/wanwei/skill-marketplace/src/client/skill-catalog-bridge.ts'

describe('Wanwei native skill catalog bridge', () => {
  it('forwards desktop install notifications and removes its listener on disposal', async () => {
    const ctx = new Context()
    const changed = vi.fn()
    ctx.on('skills/catalog-invalidated', changed)
    const fiber = ctx.plugin({ inject: [], apply: registerNativeSkillCatalogBridge })
    await fiber.await()
    window.dispatchEvent(new Event('dsh:skills-changed'))
    expect(changed).toHaveBeenCalledTimes(1)
    await fiber.dispose()
    window.dispatchEvent(new Event('dsh:skills-changed'))
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('makes a newly installed skill available to / in an existing session', async () => {
    const ctx = new Context()
    let source: InputTriggerSource | undefined
    ctx.provide('inputTriggers', { registerSource: (value: InputTriggerSource) => { source = value; return () => {} } })
    ctx.provide('connection', {})
    ctx.provide('sessions', { subagentAddress: () => undefined })
    ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key })
    const slots = new SlotRegistry(ctx)
    slots.register({ name: 'root', children: { 'tool.call.toolview': { kind: 'keyed', scope: 'session' } } } as never, () => null)
    let installed = false
    const list = vi.fn(async () => ({
      ok: true as const,
      value: { skills: installed ? [{ name: 'map-analysis', description: '地图分析', modelInvocable: true }] : [] },
    }))
    new TestRemote(ctx, { skills: { list } })
    await ctx.plugin({ inject: [...skillInject], apply: applySkill }).await()
    const bridge = ctx.plugin({ inject: [], apply: registerNativeSkillCatalogBridge })
    await bridge.await()
    const session = { sessionId: 'active-session' as SessionId }
    const request = { query: 'map', position: 'leading' as const, drilled: false, signal: new AbortController().signal }
    expect(await source!.candidates(session, request)).toEqual([])
    installed = true
    window.dispatchEvent(new Event('dsh:skills-changed'))
    expect(await source!.candidates(session, request)).toEqual([{ name: 'map-analysis', description: '地图分析' }])
    expect(list).toHaveBeenCalledTimes(2)
    await bridge.dispose()
  })
})
