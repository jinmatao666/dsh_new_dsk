import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

// Monterey's system WebView is independent of the installed Chrome version.
export const browserTarget = 'safari15.6'

/** Lower a browser artifact while retaining its module format and source map. */
export async function lowerBrowserFile(file) {
  await build({
    entryPoints: [file], outfile: file, allowOverwrite: true,
    target: browserTarget, sourcemap: 'linked', logLevel: 'warning',
  })
}

async function browserFiles(root) {
  const files = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = join(root, entry.name)
    if (entry.isDirectory()) files.push(...await browserFiles(file))
    else if (/\.(js|css)$/u.test(entry.name) && entry.name !== 'wanwei-browser-compat.js') files.push(file)
  }
  return files
}

/** Adapt only product build artifacts; upstream sources and Node bundles stay intact. */
export async function prepareBrowserCompatibility(repositoryRoot) {
  const dist = join(repositoryRoot, 'apps/web/dist')
  const files = await browserFiles(join(dist, 'assets'))
  // Plugins are fetched as CommonJS strings outside Vite's dependency graph.
  for (const group of await readdir(join(repositoryRoot, 'packages'), { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    const groupRoot = join(repositoryRoot, 'packages', group.name)
    for (const pkg of await readdir(groupRoot, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue
      const lib = join(groupRoot, pkg.name, 'lib')
      let entries
      try { entries = await readdir(lib) } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
      if (entries.includes('client.js')) files.push(join(lib, 'client.js'))
      if (entries.includes('client.css')) files.push(join(lib, 'client.css'))
    }
  }
  for (const file of files) await lowerBrowserFile(file)
  const bootstrap = await build({
    stdin: {
      contents: "import 'core-js/stable';\n" + await readFile(
        new URL('./browser-startup.js', import.meta.url), 'utf8'),
      resolveDir: resolve(import.meta.dirname, '..'),
    },
    bundle: true, platform: 'browser', format: 'iife', target: browserTarget,
    write: false, minify: true,
  })
  await writeFile(join(dist, 'assets/wanwei-browser-compat.js'), bootstrap.outputFiles[0].text)
  const indexPath = join(dist, 'index.html')
  const html = await readFile(indexPath, 'utf8')
  const tag = '<script src="./assets/wanwei-browser-compat.js"></script>'
  if (!html.includes(tag)) await writeFile(indexPath, html.replace('<head>', `<head>\n${tag}`))
  console.log(`Prepared ${files.length} browser artifacts for ${browserTarget}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await prepareBrowserCompatibility(resolve(import.meta.dirname, '../../..'))
}
