import { cpSync, existsSync, lstatSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { prepareKylinMarkdown } from './kylin-markdown.mjs'
import { prepareKylinGradients } from './kylin-gradients.mjs'

/** Copy the shared Linux runtime into the Kylin shell and set its installer version.
 * @param {string} productRoot - Desktop product directory.
 * @param {string} version - Version of the staged shared runtime.
 * @param {'x64' | 'arm64'} arch - Linux target architecture, defaulting to the build host.
 * @returns {void}
 */
export function prepareKylin(productRoot, version, arch = process.arch) {
  if (!['x64', 'arm64'].includes(arch)) throw new Error('Unsupported Kylin architecture: ' + arch)
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$/u.test(version ?? '')) {
    throw new Error('Kylin release version must be x.y.z or x.y.z-prerelease')
  }
  const resources = join(productRoot, 'src-tauri/resources')
  for (const file of ['server.json', 'runtime-' + version + '/node']) {
    if (!existsSync(join(resources, file))) throw new Error('Kylin staging requires ' + file)
  }
  const shell = join(productRoot, 'src-kylin')
  for (const name of ['resources', 'icons']) {
    const target = join(shell, name)
    if (existsSync(target)) {
      if (lstatSync(target).isSymbolicLink()) unlinkSync(target)
      else rmSync(target, { recursive: true })
    }
    cpSync(join(productRoot, 'src-tauri', name), target, {
      recursive: true,
      filter: source => {
        const parts = relative(resources, source).split(sep)
        if (parts.some(part => /^node-addon-landlock-run-linux-(x64|arm64)$/u.test(part)
          && part !== 'node-addon-landlock-run-linux-' + arch)) return false
        if (parts.some(part => part.startsWith('koffi-linux-')) && parts.some(part => /^musl_/u.test(part))) return false
        const index = parts.lastIndexOf('prebuilds')
        const platform = index >= 0 ? parts[index + 1] : undefined
        if (!platform || !/^(linux|darwin|win32)-(x64|arm64|ia32|arm)(-|$)/u.test(platform)) return true
        return (platform === 'linux-' + arch || platform.startsWith('linux-' + arch + '-')) && !platform.includes('musl')
      },
    })
  }
  const config = JSON.parse(readFileSync(join(shell, 'tauri.conf.json'), 'utf8'))
  const stagedRuntime = join(shell, 'resources', 'runtime-' + version)
  const patched = prepareKylinMarkdown(stagedRuntime)
  prepareKylinGradients(stagedRuntime)
  console.log(`Prepared ${patched} Kylin Markdown email expression(s)`)
  config.package.version = version
  writeFileSync(join(shell, 'tauri.runner.conf.json'), JSON.stringify(config, null, 2) + '\n')
  console.log('Kylin shell staged with shared runtime ' + version)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.platform !== 'linux') throw new Error('Build the Kylin shell on the Linux baseline')
  prepareKylin(resolve(import.meta.dirname, '..'), process.env.DSH_RELEASE_VERSION)
}
