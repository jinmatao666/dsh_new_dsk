function bytes(encoded: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(encoded), value => value.charCodeAt(0))
}

export async function workspacePreviewDigest(encoded: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', bytes(encoded))
  return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('')
}

export function encodePreviewText(value: string): string {
  const encoded = new TextEncoder().encode(value)
  let binary = ''
  for (let offset = 0; offset < encoded.length; offset += 8192) {
    binary += String.fromCharCode(...encoded.subarray(offset, offset + 8192))
  }
  return btoa(binary)
}

/** Replace one unambiguous run of Word text while retaining its original formatting. */
export async function replaceWorkspaceWordText(encoded: string, original: string, replacement: string): Promise<string> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes(encoded))
  const part = zip.file('word/document.xml')
  if (!part) throw new Error('Word 正文缺失')
  const xml = new DOMParser().parseFromString(await part.async('text'), 'application/xml')
  const matches = [...xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 't')]
    .filter(node => node.textContent?.includes(original))
  const target = matches[0]
  const value = target?.textContent ?? ''
  if (!original || matches.length !== 1 || !target || value.indexOf(original) !== value.lastIndexOf(original)) {
    throw new Error('请输入正文中唯一一段、使用同一格式的文字')
  }
  target.textContent = value.replace(original, () => replacement)
  target.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
  zip.file('word/document.xml', new XMLSerializer().serializeToString(xml))
  return zip.generateAsync({ type: 'base64', compression: 'DEFLATE' })
}
