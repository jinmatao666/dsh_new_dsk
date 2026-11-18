import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Match both the original CSS and compact output with an omitted downward direction.
const sidebarFade = /linear-gradient\(\s*(?:(?:to bottom|180deg)\s*,\s*)?(?:transparent|#0000)\s*,\s*var\(--dsw-specific-sidebar-fill\)\s*\)/gu
const knowledgeFade = /radial-gradient\(\s*(?:ellipse\s+)?at\s+0(?:%|px)?\s+0(?:%|px)?\s*,\s*#e0edff\s*,\s*(?:transparent|#0000)\s+74%\s*\)\s*top\s*\/\s*100%\s+220px\s+no-repeat\s*,\s*/giu

// Older WebKit can show a dark fringe when interpolating from transparent black.
/** Remove the two affected gradient layers from the copied Kylin runtime. */
export function prepareKylinGradients(root) {
  const counts = { sidebar: 0, knowledge: 0 }
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(file)
      } else if (entry.isFile() && (entry.name === 'client.js' || entry.name.endsWith('.css'))) {
        // tsdown stores plugin styles in JavaScript strings and injects them at load.
        const source = readFileSync(file, 'utf8')
        const output = source.replace(sidebarFade, () => {
          counts.sidebar++
          return 'none'
        }).replace(knowledgeFade, () => {
          counts.knowledge++
          return ''
        })
        if (output !== source) writeFileSync(file, output)
      }
    }
  }
  visit(root)
  if (counts.sidebar === 0 || counts.knowledge === 0) {
    throw new Error(`Missing Kylin gradient targets (sidebar: ${counts.sidebar}, knowledge: ${counts.knowledge})`)
  }
  return counts
}
