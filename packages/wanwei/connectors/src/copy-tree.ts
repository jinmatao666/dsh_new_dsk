/**
 * Recursive directory copy for skill installs.
 * Node 22.19's native `fs.cpSync` aborts the process or writes a mangled
 * destination on Windows when a path contains non-ASCII characters (for
 * example `D:\万维Buddy`); these per-entry calls keep paths as UTF-16.
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Copy `source` into `dest`, creating directories as needed. Symlinks are copied as their targets.
 * @param source - existing directory to copy.
 * @param dest - destination directory; existing files with the same names are overwritten.
 */
export function copyDirectoryTree(source: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(dest, entry.name)
    if (entry.isDirectory()) copyDirectoryTree(from, to)
    else copyFileSync(from, to)
  }
}
