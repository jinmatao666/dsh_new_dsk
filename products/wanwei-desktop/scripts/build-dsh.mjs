import { copyFileSync, cpSync, existsSync, readFileSync, rmSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { prepareBrowserCompatibility } from './browser-compatibility.mjs'
import { loadBrand, prepareNativeBrand, stageWebBrand, stageBrandModules, brandText } from './branding.mjs'
import { verifyBranding } from './verify-branding.mjs'

const productRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(productRoot, '..', '..')
const sourceRoot = join(productRoot, 'assets', 'web')
const publicRoot = join(repositoryRoot, 'apps', 'web', 'public')
const files = ['brand-mark.svg', 'brand-wordmark.svg']
const directories = ['connector-icons', 'skill-icons', 'expert-icons', 'expert-avatars', 'knowledge-covers']
const targets = [...files, ...directories, 'brand'].map(name => join(publicRoot, name))
const selection = loadBrand()
const { brand } = selection
// A single checkout shares tsc output and generated templates; never overlap brands.
const lockPath = join(productRoot, '.branding-build.lock')
const lock = openSync(lockPath, 'wx')
let restore = () => {}
let ownsAssets = false

try {
  for (const target of targets) {
    if (existsSync(target)) throw new Error(`Refusing to replace existing Web asset ${target}`)
  }
  ownsAssets = true
  prepareNativeBrand(selection)
  restore = stageBrandModules(brand)
  stageWebBrand(selection, publicRoot)
  for (const file of files) {
    if (file === 'brand-wordmark.svg' && selection.composed) {
      writeFileSync(join(publicRoot, file), selection.composed)
      continue
    }
    const source = selection.baseSources[file === 'brand-mark.svg' ? 'mark' : 'wordmark']
    if (source.endsWith('.svg')) copyFileSync(source, join(publicRoot, file))
    else {
      const extension = source.split('.').at(-1)
      writeFileSync(join(publicRoot, file), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><image width="256" height="256" preserveAspectRatio="xMidYMid meet" href="data:image/${extension};base64,${readFileSync(source).toString('base64')}"/></svg>`)
    }
  }
  for (const directory of directories) {
    cpSync(join(sourceRoot, directory), join(publicRoot, directory), { recursive: true, errorOnExist: true })
  }
  const result = spawnSync('pnpm', ['--dir', repositoryRoot, 'run', 'build'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      DSH_CLIENT_TITLE: brand.windowTitle,
      DSH_BOOT_WORDMARK: brand.name,
      DSH_BOOT_LOADING: brandText(brand, '正在启动，请稍候…'),
      DSH_BOOT_FAILED: brandText(brand, '启动未完成，请重试或联系管理员'),
    },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) throw new Error(`DSH build failed with exit code ${String(result.status)}`)
  const webDist = join(repositoryRoot, 'apps', 'web', 'dist')
  const manifestPath = join(webDist, 'manifest.webmanifest')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.name = brand.nameEn
  manifest.short_name = brand.nameEn
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  // Keep the original favicon URL, including when the selected asset is PNG/WebP.
  const favicon = selection.sources.favicon
  if (favicon.endsWith('.svg')) copyFileSync(favicon, join(webDist, 'favicon.svg'))
  else {
    const extension = favicon.split('.').at(-1)
    const data = readFileSync(favicon).toString('base64')
    writeFileSync(join(webDist, 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><image width="256" height="256" href="data:image/${extension};base64,${data}"/></svg>`)
  }
  await prepareBrowserCompatibility(repositoryRoot)
  const index = join(webDist, 'index.html')
  const loading = brand.assets.loading
  const style = `<style data-product-boot-brand>[data-dsh-boot]>div>div:first-child{font-size:0;width:min(240px,60vw);height:64px;background:center/contain no-repeat url(${JSON.stringify(loading)})}</style>`
  writeFileSync(index, readFileSync(index, 'utf8').replace('</head>', `${style}</head>`))
  await verifyBranding(selection)
} finally {
  restore()
  // Only remove staged assets after verifying no pre-existing asset was present.
  if (ownsAssets) for (const target of targets) rmSync(target, { recursive: true, force: true })
  closeSync(lock)
  unlinkSync(lockPath)
}
