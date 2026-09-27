import { lstatSync, rmSync, unlinkSync } from 'node:fs'

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
