import { describe, expect, it } from 'vitest'
import { internetCatalogAccess } from '../src/network-contract.ts'
import { resolveInternetCatalogPolicy } from '../src/deployment.ts'

describe('internet-dependent skill and expert presentation', () => {
  it.each(['hide', 'disable'] as const)('applies %s only to marked items without confirmed connectivity', (internetCatalogPolicy) => {
    const state = { mode: 'intranet' as const, internalOrigins: [], internetCatalogPolicy, directInternet: false }
    expect(internetCatalogAccess(state, true, 'skill')).toBe(internetCatalogPolicy)
    expect(internetCatalogAccess(state, false, 'skill')).toBe('available')
    expect(internetCatalogAccess({ ...state, directInternet: true }, true, 'skill')).toBe('available')
    expect(internetCatalogAccess({ ...state, mode: 'internet' }, true, 'skill')).toBe('available')
    expect(internetCatalogAccess({ mode: 'intranet', internalOrigins: [], internetCatalogPolicy }, true, 'skill')).toBe(internetCatalogPolicy)
  })
  it('defaults legacy settings to disabled and rejects invalid wire values', () => {
    expect(resolveInternetCatalogPolicy(undefined)).toBe('disable')
    expect(internetCatalogAccess({ mode: 'intranet', internalOrigins: [] }, true, 'skill')).toBe('disable')
    for (const value of [null, true, 1, 'unknown', {}]) expect(() => resolveInternetCatalogPolicy(value)).toThrow()
  })
})

it.each(['hide', 'disable'] as const)('keeps skill policy %s independent from expert policy', (internetSkillPolicy) => {
  const internetExpertPolicy: 'hide' | 'disable' = internetSkillPolicy === 'hide' ? 'disable' : 'hide'
  const state = { mode: 'intranet' as const, internalOrigins: [], internetCatalogPolicy: 'disable' as const,
    internetSkillPolicy, internetExpertPolicy, directInternet: false }
  expect(internetCatalogAccess(state, true, 'skill')).toBe(internetSkillPolicy)
  expect(internetCatalogAccess(state, true, 'expert')).toBe(internetExpertPolicy)
  for (const kind of ['skill', 'expert'] as const) {
    expect(internetCatalogAccess(state, false, kind)).toBe('available')
    expect(internetCatalogAccess({ ...state, directInternet: true }, true, kind)).toBe('available')
  }
})
