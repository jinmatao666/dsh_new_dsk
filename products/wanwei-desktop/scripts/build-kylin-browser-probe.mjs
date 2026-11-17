import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

// Exercise the shipped Gateway supervisor in the target WebKit, not a copy.
const result = await build({
  entryPoints: [fileURLToPath(new URL('./kylin-browser-probe.ts', import.meta.url))],
  bundle: true, platform: 'browser', format: 'iife', target: 'safari15.6',
  write: false, logLevel: 'warning',
})
process.stdout.write(result.outputFiles[0].text)
