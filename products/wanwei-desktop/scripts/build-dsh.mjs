import { copyFileSync, cpSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const productRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(productRoot, '..', '..')
const sourceRoot = join(productRoot, 'assets', 'web')
const publicRoot = join(repositoryRoot, 'apps', 'web', 'public')
const files = ['brand-mark.svg', 'brand-wordmark.svg']
const directories = ['connector-icons', 'skill-icons']
const targets = [...files, ...directories].map(name => join(publicRoot, name))

for (const target of targets) {
  if (existsSync(target)) throw new Error(`Refusing to replace existing Web asset ${target}`)
}

try {
  for (const file of files) copyFileSync(join(sourceRoot, file), join(publicRoot, file))
  for (const directory of directories) {
    cpSync(join(sourceRoot, directory), join(publicRoot, directory), { recursive: true, errorOnExist: true })
  }
  const result = spawnSync('pnpm', ['--dir', repositoryRoot, 'run', 'build'], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) throw new Error(`DSH build failed with exit code ${String(result.status)}`)
} finally {
  for (const target of targets) rmSync(target, { recursive: true, force: true })
}
