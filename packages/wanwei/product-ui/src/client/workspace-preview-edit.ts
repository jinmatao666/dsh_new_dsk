function bytes(encoded: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(encoded), value => value.charCodeAt(0))
}

/** Compute the comparison token for a file read.
 * @param encoded - Original base64 bytes.
 * @returns SHA-256 hex digest used by native save.
 */
export async function workspacePreviewDigest(encoded: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', bytes(encoded))
  return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('')
}

/** Encode an edited text document without platform newline conversion.
 * @param value - UTF-8 document text.
 * @returns Base64 bytes for native save or preview.
 */
export function encodePreviewText(value: string): string {
  const encoded = new TextEncoder().encode(value)
  let binary = ''
  for (let offset = 0; offset < encoded.length; offset += 8192) {
    binary += String.fromCharCode(...encoded.subarray(offset, offset + 8192))
  }
  return btoa(binary)
}
