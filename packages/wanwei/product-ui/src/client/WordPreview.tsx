import { useEffect, useRef, useState } from 'react'

const pageCss = `
  html, body { margin: 0; background: white; }
  .docx-wrapper, .docx-preview-wrapper {
    box-sizing: border-box; width: 100%; overflow-x: hidden; padding: 16px;
    display: flex; flex-direction: column; align-items: center; background: white;
  }
  .buddy-docx-page { position: relative; flex: none; margin: 0 auto 16px; }
  .buddy-docx-page > section:not([style*="width:"]) { width: 595pt; }
  .buddy-docx-page > section {
    position: absolute; inset: 0 auto auto 0; margin: 0 !important;
    transform: scale(var(--page-scale, 1)); transform-origin: top left;
  }
`

async function normalizeEmbeddedImages(bytes: Uint8Array): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const part = zip.file('word/document.xml')
  if (!part) return bytes
  const xml = new DOMParser().parseFromString(await part.async('text'), 'application/xml')
  let changed = false
  for (const image of xml.getElementsByTagNameNS('*', 'blip')) {
    const embedded = image.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed')
    if (embedded && image.getAttribute('embed') !== embedded) {
      image.setAttribute('embed', embedded)
      changed = true
    }
  }
  if (!changed) return bytes
  zip.file('word/document.xml', new XMLSerializer().serializeToString(xml))
  return zip.generateAsync({ type: 'uint8array' })
}

/** Render Word pages using the same engine and page-fit options as Parvis. */
export function WordPreview({ content, name }: { content: string; name: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [source, setSource] = useState('')
  const [error, setError] = useState(false)
  useEffect(() => {
    let current = true
    void import('docx-preview').then(async ({ renderAsync }) => {
      const buffer = Uint8Array.from(atob(content), character => character.charCodeAt(0))
      const container = document.createElement('div')
      const styles = document.createElement('div')
      await renderAsync(await normalizeEmbeddedImages(buffer), container, styles, {
        className: 'docx-preview', inWrapper: true, ignoreWidth: false, ignoreHeight: true,
        ignoreFonts: false, breakPages: true, useBase64URL: true, renderHeaders: true,
        renderFooters: true, renderFootnotes: true, renderEndnotes: true, renderAltChunks: false,
      })
      for (const page of container.querySelectorAll('section.docx-preview, section.docx')) {
        const wrapper = document.createElement('div')
        wrapper.className = 'buddy-docx-page'
        page.before(wrapper)
        wrapper.append(page)
      }
      const csp = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; form-action 'none'"
      if (current) setSource(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">${styles.innerHTML}<style>${pageCss}</style>${container.innerHTML}`)
    }).catch(() => { if (current) setError(true) })
    return () => { current = false }
  }, [content])
  useEffect(() => {
    const element = frame.current
    if (!element || !source) return
    const fitPages = () => {
      const doc = element.contentDocument
      if (!doc) return
      const available = Math.max(240, element.clientWidth - 32)
      for (const page of doc.querySelectorAll<HTMLElement>('.buddy-docx-page > section')) {
        const width = page.offsetWidth || page.scrollWidth
        const height = page.offsetHeight || page.scrollHeight
        if (!width || !height || !page.parentElement) continue
        const scale = width > available ? Math.max(0.25, available / width) : 1
        page.style.setProperty('--page-scale', String(scale))
        page.parentElement.style.width = Math.ceil(width * scale) + 'px'
        page.parentElement.style.height = Math.ceil(height * scale) + 'px'
      }
    }
    const onLoad = () => { fitPages(); void element.contentDocument?.fonts.ready.then(fitPages) }
    const observer = new ResizeObserver(fitPages)
    observer.observe(element)
    element.addEventListener('load', onLoad)
    fitPages()
    return () => { observer.disconnect(); element.removeEventListener('load', onLoad) }
  }, [source])
  if (error) return <p role="alert">无法预览此 Word 文档</p>
  if (!source) return <p role="status">正在渲染 Word 文档…</p>
  return <iframe ref={frame} title={name} sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={source} />
}
