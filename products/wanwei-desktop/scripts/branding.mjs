import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { resolve, join, extname, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'

export const productRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(productRoot, '../..')
const defaultPath = join(productRoot, 'branding/default.json')
const webRoot = join(productRoot, 'assets/web')
const slots = ['sidebar', 'home', 'login', 'avatar', 'credits', 'version', 'update', 'knowledge', 'favicon', 'loading']
const webExtensions = ['.png', '.svg', '.webp']
const wordmarks = new Set(['sidebar', 'home', 'login', 'loading'])
const packages = ['product-ui', 'oneapi-auth', 'knowledge-base', 'skill-marketplace', 'feature-panels', 'automations', 'expert-library', 'connectors']

/** Resolve one build's public brand manifest. File paths are relative to that manifest. */
export function loadBrand(configPath = process.env.DSH_BRAND_CONFIG) {
  const defaults = JSON.parse(readFileSync(defaultPath, 'utf8'))
  const path = configPath ? resolve(repositoryRoot, configPath) : defaultPath
  const input = JSON.parse(readFileSync(path, 'utf8'))
  const allowed = new Set([...Object.keys(defaults), 'native', 'logoText', 'logoTextColor', 'logoTextImage'])
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`Unknown branding field: ${key}`)
  if (input.schemaVersion !== 1) throw new Error('Brand schemaVersion must be 1')
  const brand = { ...defaults, ...input, assets: {}, text: input.text ?? {} }
  delete brand.native
  delete brand.logoText
  delete brand.logoTextColor
  delete brand.logoTextImage
  if (brand.name !== defaults.name) {
    for (const key of ['nameEn', 'shortName', 'organization', 'windowTitle', 'installerName', 'copyright', 'copyrightEn', 'sessionFilePrefix']) {
      if (!Object.hasOwn(input, key)) throw new Error(`Custom brand must explicitly set ${key}`)
    }
  }
  for (const key of Object.keys(defaults).filter(key => typeof defaults[key] === 'string')) {
    if (typeof brand[key] !== 'string' || !brand[key].trim() || brand[key].length > 2000 || /[\x00-\x1f]/u.test(brand[key])) throw new Error(`Invalid branding text: ${key}`)
  }
  if (!/^[\p{L}\p{N}_. -]+$/u.test(brand.installerName) || !/^[\p{L}\p{N}_.-]+$/u.test(brand.sessionFilePrefix)) throw new Error('Invalid installer name or session file prefix')
  if (!brand.text || Array.isArray(brand.text) || typeof brand.text !== 'object') throw new Error('Brand text must be a string map')
  for (const [key, value] of Object.entries(brand.text)) if (!key || typeof value !== 'string' || /\x00/u.test(value)) throw new Error('Brand text must be a string map')
  const assets = input.assets ?? {}
  if (typeof assets !== 'object' || assets === null || Array.isArray(assets)) throw new Error('Brand assets must be an object')
  for (const key of Object.keys(assets)) if (![...slots, 'mark', 'wordmark'].includes(key)) throw new Error(`Unknown brand asset slot: ${key}`)
  const file = (value, allowedExtensions) => {
    if (typeof value !== 'string' || !value) throw new Error('Brand asset must be a local file path')
    const result = resolve(dirname(path), value)
    if (!allowedExtensions.includes(extname(result).toLowerCase()) || !existsSync(result)) throw new Error(`Missing or unsupported brand asset: ${result}`)
    return result
  }
  const mark = assets.mark === undefined ? undefined : file(assets.mark, webExtensions)
  const logoText = input.logoText ?? brand.name
  const logoTextColor = input.logoTextColor ?? '#0865F2'
  if (typeof logoTextColor !== 'string' || !/^#[\da-f]{6}$/iu.test(logoTextColor)) throw new Error('logoTextColor must be a six-digit hex color, such as #0865F2')
  if (typeof logoText !== 'string' || !logoText.trim() || [...logoText].length > 64 || /[\x00-\x1f]/u.test(logoText)) throw new Error('logoText must contain 1 to 64 characters on one line')
  const lettering = input.logoTextImage === undefined ? undefined : file(input.logoTextImage, webExtensions)
  const composed = assets.wordmark === undefined && (mark || lettering || input.logoText !== undefined || input.logoTextColor !== undefined)
    ? composeWordmark(mark ?? join(webRoot, 'brand-mark.svg'), logoText, logoTextColor, lettering)
    : undefined
  const sidebarWordmark = composed && !assets.sidebar && !lettering && !/^万维 ?Buddy$/u.test(logoText)
    ? composeWordmark(mark ?? join(webRoot, 'brand-mark.svg'), logoText, logoTextColor, undefined, 65)
    : undefined
  const sources = {}
  for (const slot of slots) {
    const value = assets[slot] ?? assets[wordmarks.has(slot) ? 'wordmark' : 'mark']
    sources[slot] = value ? file(value, webExtensions) : join(webRoot, wordmarks.has(slot) ? 'brand-wordmark.svg' : 'brand-mark.svg')
    brand.assets[slot] = value ? `/brand/${slot}${extname(sources[slot]).toLowerCase()}` : wordmarks.has(slot) ? '/brand-wordmark.svg' : '/brand-mark.svg'
  }
  const native = input.native ?? {}
  if (typeof native !== 'object' || native === null || Array.isArray(native)) throw new Error('Brand native must be an object')
  for (const key of Object.keys(native)) if (!['icon', 'trayIcon', 'windowIcon'].includes(key)) throw new Error(`Unknown native brand field: ${key}`)
  const nativeFiles = Object.fromEntries(Object.entries(native).map(([key, value]) => [key, file(value, ['.png'])]))
  if (!nativeFiles.icon && mark && extname(mark).toLowerCase() === '.png') nativeFiles.icon = mark
  // A selected non-default brand cannot silently retain the old application icon or logo.
  if (brand.name !== defaults.name && (!mark || !nativeFiles.icon)) throw new Error('A custom brand requires assets.mark and a native PNG icon')
  const baseSources = Object.fromEntries(['mark', 'wordmark'].map(key => [key, assets[key] ? file(assets[key], ['.png', '.svg', '.webp']) : join(webRoot, `brand-${key}.svg`)]))
  if (sidebarWordmark) brand.assets.sidebar = '/brand/sidebar.svg'
  return { brand, sources, baseSources, composed, sidebarWordmark, nativeFiles, configPath: path }
}

function imageData(path) {
  const extension = extname(path).toLowerCase()
  const mime = extension === '.svg' ? 'svg+xml' : extension.slice(1)
  return `data:image/${mime};base64,${readFileSync(path).toString('base64')}`
}

function composeWordmark(mark, label, color, lettering, fontSize = 50) {
  // Match the stock wordmark canvas so existing logo slots keep their spacing.
  const icon = `<image x="198" y="88" width="320" height="350" href="${imageData(mark)}"/>`
  const svg = content => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 512">${icon}${content}</svg>`)
  if (lettering) {
    return svg(`<image x="608" y="150" width="1252" height="260" preserveAspectRatio="xMinYMid meet" href="${imageData(lettering)}"/>`)
  }
  if (label === '万维Buddy' || label === '万维 Buddy') {
    const original = readFileSync(join(webRoot, 'brand-wordmark.svg'), 'utf8')
    const path = original.match(/<path id="wordmark"[^>]*\/>/u)?.[0]
    if (!path) throw new Error('Original brand lettering path is missing')
    return svg(`<g fill="${color}" fill-rule="evenodd">${path}</g>`)
  }
  const textWidth = [...label].reduce((width, char) => width + (/^[\x20-\x7e]$/u.test(char) ? 42 : 51), 0)
  const escaped = label.replace(/[&<>]/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char])
  const width = fontSize === 50 ? textWidth : Math.max(textWidth, [...label].length * 48)
  return svg(`<svg x="608" y="150" width="1252" height="260" viewBox="0 0 ${width} 65" preserveAspectRatio="xMinYMid meet"><text y="50" fill="${color}" font-family="Arial Black, Microsoft YaHei, PingFang SC, sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="-1.5">${escaped}</text></svg>`)
}

export function brandText(brand, text) {
  if (Object.hasOwn(brand.text, text)) return brand.text[text]
  return text.replace(/万维 ?Buddy|WANWEI Buddy|Wanwei Buddy|WANWEI|万维/gu, match => {
    if (match === 'WANWEI') return brand.organization
    if (match === '万维') return brand.shortName
    return /^[A-Za-z]/u.test(match) ? (brand.nameEn === 'Wanwei Buddy' ? match : brand.nameEn) : (brand.name === '万维Buddy' ? match : brand.name)
  })
}

/** Generate self-contained data modules: no cross-plugin value import or runtime fetch. */
function typeScriptLiteral(value, depth = 0) {
  if (typeof value === 'string') return "'" + JSON.stringify(value).slice(1, -1).replaceAll("'", "\\'") + "'"
  if (typeof value === 'number') return String(value)
  const entries = Object.entries(value)
  if (!entries.length) return '{}'
  const indent = '  '.repeat(depth)
  return '{\n' + entries.map(([key, item]) => {
    const property = /^[A-Za-z_$][\w$]*$/u.test(key) && key !== '__proto__' ? key : '[' + typeScriptLiteral(key) + ']'
    return indent + '  ' + property + ': ' + typeScriptLiteral(item, depth + 1) + ',\n'
  }).join('') + indent + '}'
}

export function moduleSource(brand) {
  return `// Generated by products/wanwei-desktop/scripts/branding.mjs. Do not edit.\nexport const brand = ${typeScriptLiteral(brand)}\n\n/** Resolve product-owned display copy; never pass user content or protocol identifiers. */\nexport function brandText(text: string): string {\n  const overrides: Readonly<Record<string, string>> = brand.text\n  const override = Object.hasOwn(overrides, text) ? overrides[text] : undefined\n  if (override !== undefined) return override\n  return text.replace(/万维 ?Buddy|WANWEI Buddy|Wanwei Buddy|WANWEI|万维/gu, match => {\n    if (match === 'WANWEI') return brand.organization\n    if (match === '万维') return brand.shortName\n    return /^[A-Za-z]/u.test(match) ? (brand.nameEn === 'Wanwei Buddy' ? match : brand.nameEn) : (brand.name === '万维Buddy' ? match : brand.name)\n  })\n}\n`
}

/** Source templates remain default-branded after a build, even if compilation fails. */
export function stageBrandModules(brand) {
  const saved = packages.map(name => {
    const path = join(repositoryRoot, 'packages/wanwei', name, 'src/brand.generated.ts')
    return [path, readFileSync(path)]
  })
  const restore = () => { for (const [path, content] of saved) writeFileSync(path, content) }
  try { for (const [path] of saved) writeFileSync(path, moduleSource(brand)) }
  catch (error) { restore(); throw error }
  return restore
}

/** Stage only build outputs. Native identity, data directories and update keys are unchanged. */
export function prepareNativeBrand(selection, { generateIcons = true, outputRoot = join(productRoot, '.brand-build') } = {}) {
  const { brand, sources, nativeFiles } = selection
  const output = outputRoot
  mkdirSync(output, { recursive: true })
  let icons = ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.icns', 'icon.ico'].map(name => join(productRoot, 'src-tauri/icons', name))
  if (nativeFiles.icon) {
    const dir = join(output, 'icons')
    if (generateIcons) {
      const result = spawnSync(process.execPath, [join(productRoot, 'node_modules/@tauri-apps/cli/tauri.js'), 'icon', nativeFiles.icon, '--output', dir], { cwd: productRoot, stdio: 'inherit', windowsHide: true })
      if (result.status !== 0) throw new Error('Brand native icon generation failed')
    }
    icons = icons.map(path => join(dir, path.split(/[\\/]/u).at(-1)))
    for (const path of icons) if (!existsSync(path)) throw new Error(`Brand icon missing: ${path}`)
  }
  const nativeText = {
    DSH_PRODUCT_WINDOW_TITLE: brand.windowTitle,
    DSH_PRODUCT_UPDATE_TITLE: brandText(brand, '万维Buddy 更新'),
    DSH_PRODUCT_TRAY_SHOW: brandText(brand, '显示 万维Buddy'),
    DSH_PRODUCT_TRAY_QUIT: brandText(brand, '退出 万维Buddy'),
    DSH_PRODUCT_STARTUP: brandText(brand, '万维Buddy startup'),
  }
  writeFileSync(join(output, 'native.env'), Object.entries(nativeText).map(([key, value]) => `${key}=${value}`).join('\n') + '\n')
  // Copy PNGs into fixed build paths for Rust include_image!, independently of bundler icons.
  for (const [slot, key] of [['tray', 'trayIcon'], ['window', 'windowIcon']]) {
    copyFileSync(nativeFiles[key] ?? icons[0], join(output, `${slot}.png`))
  }
  writeFileSync(join(output, 'resolved.json'), JSON.stringify(brand, null, 2) + '\n')
  const config = { productName: brand.installerName, bundle: { icon: icons } }
  const html = readFileSync(join(productRoot, 'shell/index.html'), 'utf8')
  const escaped = brand.name.replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  mkdirSync(join(output, 'shell'), { recursive: true })
  writeFileSync(join(output, 'shell/index.html'), html.replaceAll('万维Buddy', escaped))
  const result = { ...config, build: { frontendDist: '../.brand-build/shell' } }
  writeFileSync(join(output, 'tauri.brand.json'), JSON.stringify(result, null, 2) + '\n')
  return result
}

/** Copy the exact per-slot assets needed by this Web build, not a previous brand's files. */
export function stageWebBrand(selection, publicRoot) {
  mkdirSync(join(publicRoot, 'brand'), { recursive: true })
  for (const [slot, source] of Object.entries(selection.sources)) {
    const url = selection.brand.assets[slot]
    if (slot === 'sidebar' && selection.sidebarWordmark) {
      writeFileSync(join(publicRoot, url.slice(1)), selection.sidebarWordmark)
      continue
    }
    if (url.startsWith('/brand/')) copyFileSync(source, join(publicRoot, url.slice(1)))
  }
}

export function writeDefaultModules() {
  const { brand } = loadBrand(defaultPath)
  for (const name of packages) writeFileSync(join(repositoryRoot, 'packages/wanwei', name, 'src/brand.generated.ts'), moduleSource(brand))
}

export { packages as brandedPackages }
