import { cpSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Copy product artwork into generated Web output, preserving compiled frontend files.
 * Existing files with the same asset names are replaced.
 * @param {string} sourceRoot - Product Web asset directory.
 * @param {string} webDist - Generated Web output directory.
 */
export function stageWebAssets(sourceRoot, webDist) {
  cpSync(sourceRoot, webDist, { recursive: true, force: true })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const productRoot = resolve(import.meta.dirname, '..')
  stageWebAssets(resolve(productRoot, 'assets/web'), resolve(productRoot, '../../apps/web/dist'))
  console.log('Staged Wanwei product Web assets.')
}
