import { encodePreviewText } from './workspace-preview-edit.ts'

const media: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' }
type Reader = (command: string, input: { root: string; parts: string[] }) => Promise<unknown>

/** Resolve document-local resources without giving the renderer filesystem privileges.
 * @param content - Base64 document bytes.
 * @param parts - Document path relative to the workspace.
 * @param root - Selected workspace root.
 * @param invoke - Privileged bounded file reader.
 * @returns Preview bytes with local resources embedded; source files remain unchanged.
 */
export async function inlinePreviewAssets(content: string, parts: string[], root: string, invoke: Reader): Promise<string> {
  const extension = parts.at(-1)?.split('.').at(-1)?.toLowerCase()
  if (!['html', 'htm', 'md', 'markdown'].includes(extension ?? '')) return content
  const pathFor = (url: string, base: string[]): string[] | undefined => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(url)) return
    const target = url.startsWith('/') ? [] : [...base]
    try {
      for (const component of url.split(/[?#]/u)[0]?.replace(/\\/gu, '/').split('/') ?? []) {
        const name = decodeURIComponent(component)
        if (!name || name === '.') continue
        if (name === '..') { if (!target.length) return; target.pop() }
        else { if (/[\\/:\0]/u.test(name)) return; target.push(name) }
      }
      return target
    } catch { return }
  }
  const cache = new Map<string, Promise<string | undefined>>()
  const image = async (url: string, base: string[]) => {
    const target = pathFor(url, base)
    const mime = media[target?.at(-1)?.split('.').at(-1)?.toLowerCase() ?? '']
    if (!target || !mime || cache.size >= 100) return
    const key = target.join('/')
    if (!cache.has(key)) cache.set(key, invoke('read_workspace_preview', { root, parts: target })
      .then(value => 'data:' + mime + ';base64,' + String(value)).catch(() => undefined))
    return cache.get(key)
  }
  const replaceImages = async (source: string, base: string[]) => {
    for (const match of [...source.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/giu)]) {
      const value = await image(match[1] ?? '', base)
      if (value) source = source.replace(match[0], 'url("' + value + '")')
    }
    return source
  }
  let source = new TextDecoder().decode(Uint8Array.from(atob(content), value => value.charCodeAt(0)))
  if (extension === 'md' || extension === 'markdown') {
    for (const match of [...source.matchAll(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))[^)]*\)/gu)]) {
      const url = match[1] ?? match[2] ?? ''
      const value = await image(url, parts.slice(0, -1))
      if (value) source = source.replace(match[0], match[0].replace(url, value))
    }
  } else {
    const document = new DOMParser().parseFromString(source, 'text/html')
    for (const node of document.querySelectorAll('img[src]')) {
      const value = await image(node.getAttribute('src') ?? '', parts.slice(0, -1))
      if (value) node.setAttribute('src', value)
    }
    for (const link of document.querySelectorAll('link[rel="stylesheet"][href]')) {
      const target = pathFor(link.getAttribute('href') ?? '', parts.slice(0, -1))
      if (!target || !target.at(-1)?.toLowerCase().endsWith('.css')) continue
      try {
        const bytes = String(await invoke('read_workspace_preview', { root, parts: target }))
        const css = new TextDecoder().decode(Uint8Array.from(atob(bytes), value => value.charCodeAt(0)))
        const style = document.createElement('style')
        style.textContent = await replaceImages(css, target.slice(0, -1))
        link.replaceWith(style)
      } catch { /* Keep unsupported resources visible as missing; do not fail the document. */ }
    }
    for (const node of document.querySelectorAll('[style]')) node.setAttribute('style', await replaceImages(node.getAttribute('style') ?? '', parts.slice(0, -1)))
    source = document.documentElement.outerHTML
  }
  return encodePreviewText(source)
}
