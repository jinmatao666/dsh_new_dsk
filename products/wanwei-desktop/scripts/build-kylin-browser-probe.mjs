import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { lowerKylinMarkdown } from './kylin-markdown.mjs'

const require = createRequire(new URL('../../../packages/client/ui-primitives/package.json', import.meta.url))

// Exercise the shipped Gateway supervisor in the target WebKit, not a copy.
const result = await build({
  entryPoints: [fileURLToPath(new URL('./kylin-browser-probe.ts', import.meta.url))],
  bundle: true, platform: 'browser', format: 'iife', target: 'safari15.6',
  write: false, logLevel: 'warning',
  outfile: 'kylin-browser-probe.js',
  loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
  alias: Object.fromEntries(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'].map(name => [name, require.resolve(name)])),
})
const css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text
if (css) process.stdout.write(`{const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.appendChild(style);}\n`)
const javascript = result.outputFiles.find(file => file.path.endsWith('.js')).text
const lowered = lowerKylinMarkdown(javascript)
if (!lowered.count) throw new Error('Kylin probe did not include the expected GFM email expression')
process.stdout.write(process.env.WANWEI_KYLIN_PROBE_UNPATCHED === '1' ? javascript : lowered.code)
