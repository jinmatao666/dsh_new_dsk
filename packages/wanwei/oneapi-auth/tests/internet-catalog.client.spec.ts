import { describe, expect, it } from 'vitest'
import { internetCatalogAccess } from '../src/network-contract.ts'
import { resolveInternetCatalogPolicy } from '../src/deployment.ts'

describe('internet-dependent skill and expert presentation', () => {
  it.each(['hide', 'disable'] as const)('applies %s only to marked items without confirmed connectivity', (internetCatalogPolicy) => {
    const state = { mode: 'intranet' as const, internalOrigins: [], internetCatalogPolicy, directInternet: false }
    expect(internetCatalogAccess(state, true)).toBe(internetCatalogPolicy)
    expect(internetCatalogAccess(state, false)).toBe('available')
    expect(internetCatalogAccess({ ...state, directInternet: true }, true)).toBe('available')
    expect(internetCatalogAccess({ ...state, mode: 'internet' }, true)).toBe('available')
    expect(internetCatalogAccess({ mode: 'intranet', internalOrigins: [], internetCatalogPolicy }, true)).toBe(internetCatalogPolicy)
  })
  it('defaults legacy settings to disabled and rejects invalid wire values', () => {
    expect(resolveInternetCatalogPolicy(undefined)).toBe('disable')
    expect(internetCatalogAccess({ mode: 'intranet', internalOrigins: [] }, true)).toBe('disable')
    for (const value of [null, true, 1, 'unknown', {}]) expect(() => resolveInternetCatalogPolicy(value)).toThrow()
  })
})
