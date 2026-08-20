import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { composeEntries, PROFILE_TEMPLATES } from '../../../boot/app-boot/src/profile.ts'
import { loadOverlayPatches } from '../../../boot/app-boot/src/index.ts'


const root = fileURLToPath(new URL('../../../..', import.meta.url))
const patch = (path: string) => loadOverlayPatches('desktop composition test', `${root}/${path}`)

describe('desktop profile composition', () => {
  it('ships the base and complete web surface before its narrow desktop overlay', () => {
    expect(PROFILE_TEMPLATES.desktop).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@deepseek-ai/dsh-desktop',
    ])
    const entries = composeEntries([
      patch('packages/bundle/base/cordis.patch.yml'),
      patch('packages/bundle/web-app/cordis.patch.yml'),
      patch('packages/bundle/desktop/cordis.patch.yml'),
    ])
    const ids = entries.map(entry => entry.id)
    expect(ids).toContain('ui-settings-models')
    expect(ids).toContain('ui-settings-plugins')
    expect(ids).toContain('tool-fs')
    expect(ids.filter(id => id === 'ui-oneapi-auth')).toHaveLength(1)
    expect(entries.find(entry => entry.id === 'ui-oneapi-auth')).toMatchObject({
      name: '@deepseek-ai/dsh-client-ui-oneapi-auth',
    })
  })
})
