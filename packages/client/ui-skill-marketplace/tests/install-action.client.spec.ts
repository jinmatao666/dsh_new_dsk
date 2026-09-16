import { describe, expect, it } from 'vitest'
import { marketplaceInstallAction } from '../src/client/install-action.ts'

describe('marketplace skill install action', () => {
  it('updates an outdated installed skill in one operation', () => {
    expect(marketplaceInstallAction('updateAvailable')).toBe('update')
  })

  it('keeps ordinary install and uninstall actions distinct', () => {
    expect(marketplaceInstallAction('notInstalled')).toBe('install')
    expect(marketplaceInstallAction('conflict')).toBe('install')
    expect(marketplaceInstallAction('installed')).toBe('uninstall')
  })
})
