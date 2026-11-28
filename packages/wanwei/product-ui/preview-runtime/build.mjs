import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { transformAsync } from '@babel/core'
import solid from 'babel-preset-solid'
import typescript from '@babel/preset-typescript'
import tailwind from 'tailwindcss'

const directory = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
let pending

/** Compile the isolated Parvis renderer without changing the upstream build preset. */
export function previewRuntimePlugin() {
  return {
    name: 'wanwei-parvis-preview',
    watchChange() { pending = undefined },
    resolveId(id) {
      if (/ParvisRuntime\.(?:ts|js)\?parvis-preview$/u.test(id)) return '\0wanwei-parvis-preview'
      return null
    },
    async load(id) {
      if (id !== '\0wanwei-parvis-preview' && !/ParvisRuntime\.(?:ts|js)\?parvis-preview$/u.test(id)) return null
      for (const file of await readdir(directory)) {
        if (/\.(?:tsx?|mjs|css)$/u.test(file)) this.addWatchFile(resolve(directory, file))
      }
      pending ??= compilePreview()
      return { code: `export default ${JSON.stringify(await pending)}`, map: null }
    },
  }
}

export async function compilePreview() {
  const postcss = createRequire(require.resolve('tailwindcss/package.json'))('postcss')
  const tokens = {
    'background-stronger': '#f8f9fa', 'background-base': '#ffffff', 'background-selected': '#eef2f7',
    'text-default': '#414651', 'text-strong': '#181d27', 'text-weak': '#717680',
    'border-base': '#d5d7da', 'border-weak-base': '#e9eaeb', 'surface-weak': '#fafafa',
    'surface-base-active': '#e9eaeb', 'surface-raised-base': '#fff',
  }
  const css = await postcss([tailwind({
    content: [resolve(directory, '*.{tsx,ts}')],
    theme: { extend: { colors: tokens, fontSize: {
      'base-regular': ['14px', '20px'], 'sm-regular': ['12px', '16px'],
      '14-semibold': ['14px', { lineHeight: '20px', fontWeight: '600' }],
    } } },
  })]).process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined })
  const result = await build({
    entryPoints: [resolve(directory, 'entry.tsx')], outfile: 'preview.js', bundle: true, write: false, format: 'iife',
    platform: 'browser', target: 'es2022', minify: true, conditions: ['browser'],
    loader: { '.svg': 'dataurl', '.gif': 'dataurl', '.png': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.BASE_URL': '"/"' },
    plugins: [{ name: 'parvis-source-adapter', setup(context) {
      context.onResolve({ filter: /^parvis-pdf-assets$/ }, () => ({ path: 'pdf-assets', namespace: 'inline-pdf-assets' }))
      context.onLoad({ filter: /.*/, namespace: 'inline-pdf-assets' }, async () => {
        const root = dirname(require.resolve('pdfjs-dist/package.json'))
        const assets = {}
        for (const [kind, folder] of [['cMapUrl', 'cmaps'], ['standardFontDataUrl', 'standard_fonts'], ['wasmUrl', 'wasm']]) {
          for (const name of await readdir(resolve(root, folder))) {
            if (!/\.(?:bcmap|pfb|ttf|otf|wasm|js)$/u.test(name)) continue
            assets[kind + '/' + name] = (await readFile(resolve(root, folder, name))).toString('base64')
          }
        }
        return { contents: `const assets=${JSON.stringify(assets)}; export class InlinePdfAssets { async fetch({kind,filename}) { const value=assets[kind+'/'+filename]; if(!value)throw new Error('Missing PDF asset: '+filename); return Uint8Array.from(atob(value),c=>c.charCodeAt(0)); } }`, loader: 'js' }
      })
      context.onResolve({ filter: /^@\/components\/session\// }, args => ({ path: resolve(directory, args.path.split('/').at(-1) + '.tsx') }))
      context.onResolve({ filter: /^@\/utils\/preview-edit$/ }, () => ({ path: resolve(directory, 'preview-edit.ts') }))
      context.onResolve({ filter: /^@opencode-ai\/ui\/(icon-button|markdown)$/ }, () => ({ path: resolve(directory, 'ui-adapter.tsx') }))
      context.onResolve({ filter: /pdf\.worker\.mjs\?url$/ }, () => ({ path: require.resolve('pdfjs-dist/build/pdf.worker.mjs'), namespace: 'inline-worker' }))
      context.onLoad({ filter: /.*/, namespace: 'inline-worker' }, async args => ({
        contents: `export default URL.createObjectURL(new Blob([${JSON.stringify(await readFile(args.path, 'utf8'))}],{type:'text/javascript'}))`, loader: 'js',
      }))
      context.onLoad({ filter: /\.tsx$/ }, async args => {
        let source = await readFile(args.path, 'utf8')
        source = source.replace('import type { FileContent } from "@opencode-ai/sdk/v2"', 'type FileContent = { content: string; mimeType?: string }')
        if (args.path.endsWith('office-preview.tsx')) {
          source = source.replace(/const pdfjsAssetBase[\s\S]*?useWorkerFetch: false,\n\}/u,
            'const pdfjsDocumentOptions = { BinaryDataFactory: InlinePdfAssets, useWorkerFetch: false, isEvalSupported: false }')
          source = 'import { InlinePdfAssets } from "parvis-pdf-assets";\n' + source
        }
        const transformed = await transformAsync(source, { filename: args.path, babelrc: false, configFile: false,
          presets: [[solid, { generate: 'dom' }], [typescript, { allExtensions: true, isTSX: true }]],
        })
        return { contents: transformed.code, loader: 'js', resolveDir: dirname(args.path) }
      })
    } }],
  })
  const scripts = result.outputFiles.find(file => file.path.endsWith('.js')) ?? result.outputFiles[0]
  const styles = result.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n')
  const license = (await readFile(resolve(directory, 'LICENSE'), 'utf8')).replaceAll('-->', '-- >')
  return '<!doctype html><!-- Parvis derived preview runtime.\n' + license + '\n--><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'wasm-unsafe-eval\' blob:; worker-src blob:; img-src data: blob:; font-src data: blob:; style-src \'unsafe-inline\'; connect-src data: blob:; form-action \'none\'">'
    + '<style>' + css.css + styles + '\nhtml,body,#root{height:100%;margin:0;overflow:hidden}button{cursor:pointer} :root{--border-base:#d5d7da;--border-strong-base:#a4a7ae;--surface-inset-strong:#e9eaeb;--surface-raised-stronger-non-alpha:#fff;--surface-base-active:#e9eaeb;--border-weaker-base:#e9eaeb;--text-weak:#717680;--text-strong:#181d27;--text-base:#414651}</style><div id="root"></div><script>'
    + scripts.text.replace(/<\/script/giu, '<\\/script') + '</script>'
}
