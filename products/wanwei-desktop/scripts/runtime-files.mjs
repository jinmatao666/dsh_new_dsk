import { lstatSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/** Directory names never needed by the packaged desktop Node runtime. */
const SKIP_STAGED_DIRECTORIES = new Set([
  'tests',
  '__tests__',
  'coverage',
  '.git',
  '.github',
  '.turbo',
  '.vite',
  'fixtures',
])

/**
 * Whether a staged basename looks like a Vitest/Jest test module.
 * @param {string} name - file basename.
 * @returns {boolean} true for `*.spec.ts` / `*.test.tsx` style names.
 */
function isStagedTestFileName(name) {
  const lower = name.toLowerCase()
  return lower.endsWith('.spec.ts')
    || lower.endsWith('.spec.tsx')
    || lower.endsWith('.spec.mts')
    || lower.endsWith('.spec.cts')
    || lower.endsWith('.spec.js')
    || lower.endsWith('.spec.jsx')
    || lower.endsWith('.spec.mjs')
    || lower.endsWith('.spec.cjs')
    || lower.endsWith('.test.ts')
    || lower.endsWith('.test.tsx')
    || lower.endsWith('.test.mts')
    || lower.endsWith('.test.cts')
    || lower.endsWith('.test.js')
    || lower.endsWith('.test.jsx')
    || lower.endsWith('.test.mjs')
    || lower.endsWith('.test.cjs')
}

/**
 * Whether a staged tree entry is development-only and must not enter the installer.
 * Skipping `tests/` avoids Windows MAX_PATH extract failures on long `.spec.ts` paths.
 * @param {string} name - basename under a package or node_modules tree.
 * @param {boolean} isDirectory - directory vs file.
 * @returns {boolean} true when the entry must be omitted.
 */
export function shouldSkipStagedRuntimeEntry(name, isDirectory) {
  if (isDirectory) return SKIP_STAGED_DIRECTORIES.has(name)
  return isStagedTestFileName(name)
}

/** Remove a staged entry without following a dependency symlink or Windows junction. */
export function removeStagedEntry(path) {
  let metadata
  try {
    metadata = lstatSync(path)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  if (metadata.isSymbolicLink()) unlinkSync(path)
  else rmSync(path, { recursive: true, force: true })
}

/**
 * Delete development-only directories and test files left under a staged app tree.
 * @param {string} root - staged runtime app directory or a package directory.
 */
export function pruneStagedRuntimeDevArtifacts(root) {
  let metadata
  try {
    metadata = lstatSync(root)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) return
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (shouldSkipStagedRuntimeEntry(entry.name, entry.isDirectory())) {
      removeStagedEntry(path)
      continue
    }
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      pruneStagedRuntimeDevArtifacts(path)
    }
  }
}
