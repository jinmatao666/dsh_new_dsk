import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/AnalysisResultCard.module.css', import.meta.url)), 'utf8')

function block(selector: string): string {
  const match = new RegExp(`^\\${selector} \\{([^}]*)\\}`, 'm').exec(css)
  if (match === null) throw new Error(`AnalysisResultCard.module.css has no \`${selector}\` rule`)
  return match[1] ?? ''
}

describe('AnalysisResultCard table styles', () => {
  it('paints sticky table headings above rows with an opaque surface', () => {
    const heading = block('.tableWrap th')
    expect(heading).toContain('position: sticky')
    expect(heading).toContain('z-index: 1')
    expect(heading).toContain('background: var(--dsw-alias-bg-layer-2)')
    expect(heading).not.toContain('interactive-bg-hover')
  })
})
