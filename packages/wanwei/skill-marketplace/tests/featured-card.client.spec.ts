import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The panel is Loader-owned; keep this template guard without exporting it for tests.
const source = readFileSync(new URL('../src/client/plugin.tsx', import.meta.url), 'utf8')
const featured = source.match(/className="dsh-skill-featured-card"([\s\S]*?)<\/article>/u)?.[1]

describe('recommendation card metadata', () => {
  it('shares verified download metadata with platform cards instead of installation controls', () => {
    expect(featured).toBeDefined()
    expect(featured).toContain('className="dsh-skill-card-meta"')
    expect(featured).toContain('hasVerifiedInstallCount(skill) && <small><DownloadIcon />{skill.installs}</small>')
    expect(featured).not.toContain('<button')
    expect(featured).not.toContain('toggleInstall')
    expect(featured).not.toContain('resolveInstallState')
    expect(featured).toContain('openDetail(skill)')
    expect(featured).toContain('dsh-skill-installed-badge')
  })
})
