import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transformSync } from 'esbuild'

export const emailPattern = String.raw`(?<=^|\s|\p{P}|\p{S})([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)`

// Match the same positions and captures without lookbehind. Keep exec on the
// instance: neither the global RegExp constructor nor other patterns change.
function emailWithoutLookbehind() {
  const pattern = /([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/gu
  const exec = pattern.exec
  pattern.exec = function (input) {
    let match
    while ((match = exec.call(this, input)) !== null) {
      const preceding = Array.from(input.slice(Math.max(0, match.index - 2), match.index)).pop()
      if (match.index === 0 || /[\s\p{P}\p{S}]/u.test(preceding)) return match
      this.lastIndex = match.index + 1
    }
    return null
  }
  return pattern
}

/** Rewrite only the shipped GFM email expression in Kylin browser artifacts. */
export function lowerKylinMarkdown(source) {
  let count = 0
  const code = source.replace(/new RegExp\(\s*("(?:\\.|[^"\\])*")\s*,\s*"gu"\s*\)/gu, (expression, literal) => {
    if (JSON.parse(literal) !== emailPattern) return expression
    count++
    return `(${emailWithoutLookbehind.toString()})()`
  })
  return { code, count }
}

/** Adapt the copied Kylin runtime only; the shared Tauri 2 runtime is untouched. */
export function prepareKylinMarkdown(root) {
  let count = 0
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (entry.isFile() && entry.name.endsWith('.js')) {
        const result = lowerKylinMarkdown(readFileSync(file, 'utf8'))
        if (result.count) {
          const transformed = transformSync(result.code, {
            sourcefile: entry.name, sourcemap: 'external', target: 'safari15.6',
          })
          writeFileSync(file, transformed.code + `//# sourceMappingURL=${entry.name}.map\n`)
          writeFileSync(file + '.map', transformed.map)
          count += result.count
        }
      }
    }
  }
  visit(root)
  return count
}
