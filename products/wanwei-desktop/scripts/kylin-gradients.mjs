import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Match both the original CSS and compact output with an omitted downward direction.
const sidebarFade = /linear-gradient\(\s*(?:(?:to bottom|180deg)\s*,\s*)?(?:transparent|#0000)\s*,\s*var\(--dsw-specific-sidebar-fill\)\s*\)/gu
const knowledgeFade = /radial-gradient\(\s*ellipse at 0(?:%|px)? 0(?:%|px)?\s*,\s*#e0edff\s*,\s*(?:transparent|#0000)\s+74%\s*\)/giu

// Older WebKit can show a dark fringe when interpolating from transparent black.
/** Replace the two gradients in the copied Kylin runtime CSS. */
export function prepareKylinGradients(root) {
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(file)
      } else if (entry.isFile() && entry.name.endsWith('.css')) {
        const source = readFileSync(file, 'utf8')
        const sidebar = source.replace(sidebarFade,
          'linear-gradient(to bottom, var(--wanwei-kylin-sidebar-clear), var(--dsw-specific-sidebar-fill))')
        const knowledge = sidebar.replace(knowledgeFade,
          'radial-gradient(ellipse at 0 0, #e0edff, rgba(224, 237, 255, 0) 74%)')
        const theme = sidebar === source ? '' : '\nbody { --wanwei-kylin-sidebar-clear: rgba(249, 250, 251, 0); }\n'
          + 'body[data-ds-dark-theme] { --wanwei-kylin-sidebar-clear: rgba(27, 27, 28, 0); }\n'
        if (knowledge !== source) writeFileSync(file, knowledge + theme)
      }
    }
  }
  visit(root)
}
