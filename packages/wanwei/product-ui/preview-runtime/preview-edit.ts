/* oxlint-disable -- Parvis source retained with its original control flow and types; see preview-runtime/LICENSE. */
export type PreviewTextSelection = {
  selectedText: string
  contextBefore: string
  contextAfter: string
  start?: number
  end?: number
  menu: {
    x: number
    y: number
  }
}

export type PreviewLocateResult =
  | { ok: true; start: number; end: number }
  | { ok: false; reason: "not_found" | "ambiguous" }

export function buildTransformPrompt(text: string, action: "polish" | "expand" | "shorten") {
  const prompts = {
    polish: `请润色以下文本，保持原意，使其更加流畅、专业。只返回润色后的文本，不要添加任何解释或额外内容：\n\n${text}`,
    expand: `请扩写以下文本，增加细节和深度。只返回扩写后的文本，不要添加任何解释或额外内容：\n\n${text}`,
    shorten: `请缩写以下文本，保留核心要点。只返回缩写后的文本，不要添加任何解释或额外内容：\n\n${text}`,
  }
  return prompts[action]
}

export function findAllOccurrences(content: string, needle: string): number[] {
  if (!needle) return []
  const matches: number[] = []
  let start = 0
  while (start <= content.length - needle.length) {
    const index = content.indexOf(needle, start)
    if (index === -1) break
    matches.push(index)
    start = index + Math.max(1, needle.length)
  }
  return matches
}

export function locateSelection(content: string, selection: PreviewTextSelection): PreviewLocateResult {
  const selectedText = selection.selectedText
  if (!selectedText) return { ok: false, reason: "not_found" }

  if (
    selection.start !== undefined &&
    selection.end !== undefined &&
    selection.start >= 0 &&
    selection.end >= selection.start &&
    content.slice(selection.start, selection.end) === selectedText
  ) {
    return { ok: true, start: selection.start, end: selection.end }
  }

  const before = selection.contextBefore.slice(-80)
  const after = selection.contextAfter.slice(0, 80)
  let matches = findAllOccurrences(content, selectedText)

  if (before || after) {
    const anchored = matches.filter((index) => {
      const beforeText = content.slice(Math.max(0, index - before.length), index)
      const afterText = content.slice(index + selectedText.length, index + selectedText.length + after.length)
      return (!before || beforeText.endsWith(before)) && (!after || afterText.startsWith(after))
    })
    if (anchored.length > 0) matches = anchored
  }

  if (matches.length === 0) return { ok: false, reason: "not_found" }
  if (matches.length > 1) return { ok: false, reason: "ambiguous" }
  return { ok: true, start: matches[0]!, end: matches[0]! + selectedText.length }
}

function collapseWhitespaceWithMap(content: string) {
  let text = ""
  const startMap: number[] = []
  const endMap: number[] = []
  let inWhitespace = false

  for (let index = 0; index < content.length; index++) {
    const char = content[index]!
    if (/\s/.test(char)) {
      if (inWhitespace) {
        endMap[endMap.length - 1] = index + 1
        continue
      }
      inWhitespace = true
      text += " "
      startMap.push(index)
      endMap.push(index + 1)
      continue
    }

    inWhitespace = false
    text += char
    startMap.push(index)
    endMap.push(index + 1)
  }

  return { text, startMap, endMap }
}

function collapseWhitespace(content: string) {
  return content.replace(/\s+/g, " ").trim()
}

function locateSelectionWithCollapsedWhitespace(
  content: string,
  selection: PreviewTextSelection,
): PreviewLocateResult {
  const selectedText = collapseWhitespace(selection.selectedText)
  if (!selectedText) return { ok: false, reason: "not_found" }

  const collapsed = collapseWhitespaceWithMap(content)
  const leadingWhitespace = collapsed.text.match(/^\s+/)?.[0].length ?? 0
  const trailingWhitespace = collapsed.text.match(/\s+$/)?.[0].length ?? 0
  const text = collapsed.text.slice(leadingWhitespace, collapsed.text.length - trailingWhitespace)
  const startOffset = leadingWhitespace

  let matches = findAllOccurrences(text, selectedText).map((index) => index + startOffset)
  const before = collapseWhitespace(selection.contextBefore).slice(-80)
  const after = collapseWhitespace(selection.contextAfter).slice(0, 80)

  if (before || after) {
    const anchored = matches.filter((index) => {
      const beforeText = collapseWhitespace(collapsed.text.slice(0, index)).slice(-before.length)
      const afterText = collapseWhitespace(collapsed.text.slice(index + selectedText.length)).slice(0, after.length)
      return (!before || beforeText.endsWith(before)) && (!after || afterText.startsWith(after))
    })
    if (anchored.length > 0) matches = anchored
  }

  if (matches.length === 0) return { ok: false, reason: "not_found" }
  if (matches.length > 1) return { ok: false, reason: "ambiguous" }

  const start = collapsed.startMap[matches[0]!]
  const end = collapsed.endMap[matches[0]! + selectedText.length - 1]
  if (start === undefined || end === undefined) return { ok: false, reason: "not_found" }
  return { ok: true, start, end }
}

export function replaceSelectionText(
  content: string,
  selection: PreviewTextSelection,
  replacement: string,
): { ok: true; content: string } | { ok: false; reason: "not_found" | "ambiguous" } {
  const located = locateSelection(content, selection)
  if (!located.ok) return located
  return {
    ok: true,
    content: content.slice(0, located.start) + replacement + content.slice(located.end),
  }
}

export function insertAfterSelection(
  content: string,
  selection: PreviewTextSelection,
  insertion: string,
): { ok: true; content: string } | { ok: false; reason: "not_found" | "ambiguous" } {
  const located = locateSelection(content, selection)
  if (!located.ok) return located
  return {
    ok: true,
    content: content.slice(0, located.end) + insertion + content.slice(located.end),
  }
}

function rangeRect(range: Range) {
  const rect = range.getBoundingClientRect()
  if (rect.width > 0 || rect.height > 0) return rect
  return Array.from(range.getClientRects()).find((item) => item.width > 0 || item.height > 0)
}

export function selectionSnapshotFromTextAndRect(input: {
  selectedText: string
  rect: DOMRect | ClientRect
  source: string
  offsetX?: number
  offsetY?: number
}): PreviewTextSelection | undefined {
  const selectedText = input.selectedText
  if (!selectedText.trim()) return

  const matches = findAllOccurrences(input.source, selectedText)
  const start = matches.length === 1 ? matches[0] : undefined
  const end = start === undefined ? undefined : start + selectedText.length
  const contextBefore = start === undefined ? "" : input.source.slice(Math.max(0, start - 80), start)
  const contextAfter = end === undefined ? "" : input.source.slice(end, end + 80)

  return {
    selectedText,
    contextBefore,
    contextAfter,
    start,
    end,
    menu: {
      x: input.rect.left + (input.offsetX ?? 0) + input.rect.width / 2,
      y: input.rect.top + (input.offsetY ?? 0),
    },
  }
}

export function selectionSnapshotFromTextAndPoint(input: {
  selectedText: string
  source: string
  x: number
  y: number
}): PreviewTextSelection | undefined {
  const selectedText = input.selectedText
  if (!selectedText.trim()) return

  const matches = findAllOccurrences(input.source, selectedText)
  const start = matches.length === 1 ? matches[0] : undefined
  const end = start === undefined ? undefined : start + selectedText.length
  const contextBefore = start === undefined ? "" : input.source.slice(Math.max(0, start - 80), start)
  const contextAfter = end === undefined ? "" : input.source.slice(end, end + 80)

  return {
    selectedText,
    contextBefore,
    contextAfter,
    start,
    end,
    menu: {
      x: input.x,
      y: input.y,
    },
  }
}

function nodeBelongsTo(container: HTMLElement, node: Node | null) {
  if (!node) return false
  let current: Node | null = node
  while (current) {
    if (current === container) return true
    current = current.parentNode
  }

  const root = node.getRootNode()
  if (root instanceof ShadowRoot) return container.contains(root.host)
  return false
}

function shadowRootsIn(container: HTMLElement) {
  const roots: ShadowRoot[] = []
  if (container.shadowRoot) roots.push(container.shadowRoot)
  for (const node of Array.from(container.querySelectorAll("*"))) {
    if (node instanceof HTMLElement && node.shadowRoot) roots.push(node.shadowRoot)
  }
  return roots
}

function composedRange(selection: Selection, roots: ShadowRoot[]) {
  return (
    (
      selection as unknown as {
        getComposedRanges?: (options?: { shadowRoots?: ShadowRoot[] }) => Range[]
      }
    ).getComposedRanges?.({ shadowRoots: roots })?.[0] ??
    (selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined)
  )
}

export function selectionSnapshotFromWindow(container: HTMLElement, source: string): PreviewTextSelection | undefined {
  const roots = shadowRootsIn(container)
  const selections: Array<{ selection: Selection; roots: ShadowRoot[] }> = []
  for (const root of roots) {
    const selection = (root as unknown as { getSelection?: () => Selection | null }).getSelection?.()
    if (selection && !selection.isCollapsed) selections.push({ selection, roots: [root] })
  }

  const windowSelection = window.getSelection()
  if (windowSelection && !windowSelection.isCollapsed) selections.push({ selection: windowSelection, roots })

  for (const item of selections) {
    const range = composedRange(item.selection, item.roots)
    const startNode = range?.startContainer ?? item.selection.anchorNode
    const endNode = range?.endContainer ?? item.selection.focusNode
    if (!nodeBelongsTo(container, startNode) || !nodeBelongsTo(container, endNode)) continue

    const selectedText = item.selection.toString()
    if (!selectedText.trim()) continue

    const rect = range ? rangeRect(range) : undefined
    if (!rect) continue

    return selectionSnapshotFromTextAndRect({
      selectedText,
      rect,
      source,
    })
  }
}

function caretRangeFromPoint(point: { x: number; y: number }) {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  const range = doc.caretRangeFromPoint?.(point.x, point.y)
  if (range) return range

  const position = doc.caretPositionFromPoint?.(point.x, point.y)
  if (!position) return

  const next = document.createRange()
  next.setStart(position.offsetNode, position.offset)
  next.collapse(true)
  return next
}

export function selectionSnapshotFromPoints(
  container: HTMLElement,
  source: string,
  startPoint: { x: number; y: number },
  endPoint: { x: number; y: number },
): PreviewTextSelection | undefined {
  const start = caretRangeFromPoint(startPoint)
  const end = caretRangeFromPoint(endPoint)
  if (!start || !end) return
  if (!nodeBelongsTo(container, start.startContainer) || !nodeBelongsTo(container, end.startContainer)) return

  const startBeforeEnd = start.compareBoundaryPoints(Range.START_TO_START, end) <= 0
  const range = document.createRange()
  range.setStart(
    startBeforeEnd ? start.startContainer : end.startContainer,
    startBeforeEnd ? start.startOffset : end.startOffset,
  )
  range.setEnd(
    startBeforeEnd ? end.startContainer : start.startContainer,
    startBeforeEnd ? end.startOffset : start.startOffset,
  )

  const selectedText = range.toString()
  if (!selectedText.trim()) return
  const rect = rangeRect(range)
  if (!rect) return

  return selectionSnapshotFromTextAndRect({
    selectedText,
    rect,
    source,
  })
}

export function selectedTextFromContainerSelection(container: HTMLElement) {
  for (const root of shadowRootsIn(container)) {
    const text = (root as unknown as { getSelection?: () => Selection | null }).getSelection?.()?.toString?.() ?? ""
    if (text.trim()) return text
  }

  const selection = window.getSelection?.()
  const text = selection?.toString?.() ?? ""
  if (!text.trim()) return ""
  if (!selection || selection.isCollapsed) return ""
  if (nodeBelongsTo(container, selection.anchorNode) && nodeBelongsTo(container, selection.focusNode)) return text

  // WebKit may expose selected text while keeping anchor/focus outside the expected subtree.
  return text
}

export function selectionSnapshotFromDragText(
  container: HTMLElement,
  source: string,
  startPoint: { x: number; y: number },
  endPoint: { x: number; y: number },
): PreviewTextSelection | undefined {
  const selectedText = selectedTextFromContainerSelection(container)
  if (!selectedText.trim()) return

  return selectionSnapshotFromTextAndPoint({
    selectedText,
    source,
    x: (startPoint.x + endPoint.x) / 2,
    y: Math.min(startPoint.y, endPoint.y),
  })
}

export function quoteSummary(text: string) {
  const flat = text.replace(/\n/g, " ")
  return flat.length > 20 ? flat.slice(0, 10) + " ...... " + flat.slice(-10) : flat
}

export function filenameStem(path: string) {
  const name = path.split("/").pop() ?? "file"
  const index = name.lastIndexOf(".")
  return index > 0 ? name.slice(0, index) : name
}

export function chartAssetPath(filePath: string, caption: string, extension = "png") {
  const dir = filePath.split("/").slice(0, -1).join("/")
  const stem = filenameStem(filePath)
  const safeCaption = caption
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  const name = `${stem}-chart-${Date.now()}-${safeCaption || "chart"}.${extension}`
  return `${dir ? `${dir}/` : ""}assets/${name}`
}

export function relativeAssetPath(filePath: string, assetPath: string) {
  const fileParts = filePath.split("/").slice(0, -1)
  const assetParts = assetPath.split("/")
  while (fileParts.length > 0 && assetParts.length > 0 && fileParts[0] === assetParts[0]) {
    fileParts.shift()
    assetParts.shift()
  }
  return `${"../".repeat(fileParts.length)}${assetParts.join("/")}`
}

export function pngBase64FromDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/png;base64,(.+)$/)
  if (!match) throw new Error("图表 PNG 数据无效")
  return match[1]!
}

function imageMimeTypeFromBase64(base64: string) {
  const chunk = base64.replace(/\s/g, "").slice(0, 96)
  if (!chunk) return

  let bytes: number[]
  try {
    bytes = Array.from(atob(chunk), (char) => char.charCodeAt(0))
  } catch {
    return
  }

  const ascii = String.fromCharCode(...bytes).trimStart()
  if (bytes[0] === 0x89 && ascii.slice(1, 4) === "PNG") return "image/png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return "image/gif"
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image/webp"
  if (ascii.startsWith("BM")) return "image/bmp"
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return "image/x-icon"
  if (ascii.startsWith("<svg") || (ascii.startsWith("<?xml") && ascii.includes("<svg"))) return "image/svg+xml"
}

function imageMimeTypeFromPath(path: string) {
  const extension = path.split(/[?#]/, 1)[0]?.split(".").pop()?.toLowerCase()
  switch (extension) {
    case "png":
      return "image/png"
    case "jpg":
    case "jpeg":
      return "image/jpeg"
    case "gif":
      return "image/gif"
    case "webp":
      return "image/webp"
    case "bmp":
      return "image/bmp"
    case "ico":
      return "image/x-icon"
    case "svg":
      return "image/svg+xml"
  }
}

export function imageDataUrlWithDetectedMime(dataUrl: string) {
  if (!dataUrl.startsWith("data:")) return dataUrl

  const commaIndex = dataUrl.indexOf(",")
  if (commaIndex === -1) return dataUrl

  const meta = dataUrl.slice(5, commaIndex).toLowerCase()
  if (!meta.includes("base64")) return dataUrl

  const currentMime = meta.split(";")[0] ?? ""
  if (currentMime && currentMime !== "application/octet-stream" && currentMime !== "binary/octet-stream") {
    return dataUrl
  }

  const base64 = dataUrl.slice(commaIndex + 1)
  const detectedMime = imageMimeTypeFromBase64(base64)
  return detectedMime ? `data:${detectedMime};base64,${base64}` : dataUrl
}

export function imageBlobUrlFromDataUrl(dataUrl: string) {
  const normalized = imageDataUrlWithDetectedMime(dataUrl)
  if (!normalized.startsWith("data:image/")) return

  const commaIndex = normalized.indexOf(",")
  if (commaIndex === -1) return

  const meta = normalized.slice(5, commaIndex)
  if (!meta.toLowerCase().includes("base64")) return

  const mime = meta.split(";")[0]
  if (!mime) return

  try {
    const binary = atob(normalized.slice(commaIndex + 1))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index)
    }
    return URL.createObjectURL(new Blob([bytes], { type: mime }))
  } catch {
    return
  }
}

function resolveDocxPartPath(basePartPath: string, target: string) {
  const cleanTarget = target.split("#", 1)[0]?.split("?", 1)[0] ?? target
  const rawParts = (cleanTarget.startsWith("/")
    ? cleanTarget.slice(1)
    : `${basePartPath.split("/").slice(0, -1).join("/")}/${cleanTarget}`
  ).split("/")
  const parts: string[] = []
  for (const part of rawParts) {
    if (!part || part === ".") continue
    if (part === "..") {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join("/")
}

function xmlLocalName(node: Node | Attr) {
  const name =
    "localName" in node && node.localName
      ? node.localName
      : "nodeName" in node && node.nodeName
        ? node.nodeName
        : "name" in node
          ? node.name
          : ""
  const separator = name.lastIndexOf(":")
  return separator === -1 ? name : name.slice(separator + 1)
}

function docxRelationshipsById(doc: Document) {
  const relationships = new Map<string, { target: string; targetMode?: string }>()
  for (const node of Array.from(doc.getElementsByTagName("*"))) {
    if (xmlLocalName(node) !== "Relationship") continue
    const id = node.getAttribute("Id")
    const target = node.getAttribute("Target")
    if (!id || !target) continue
    relationships.set(id, { target, targetMode: node.getAttribute("TargetMode") ?? undefined })
  }
  return relationships
}

export async function docxImageDataUrlsForPreview(input: ArrayBuffer): Promise<string[]> {
  const JSZip = (await import("jszip")).default
  const zip = await JSZip.loadAsync(input)
  const documentPartPath = "word/document.xml"
  const documentPart = zip.file(documentPartPath)
  const relsPart = zip.file("word/_rels/document.xml.rels")
  if (!documentPart || !relsPart) return []

  const documentDoc = parseXmlDocument(await documentPart.async("text"))
  const relsDoc = parseXmlDocument(await relsPart.async("text"))
  const rels = docxRelationshipsById(relsDoc)
  const dataUrls: string[] = []

  for (const node of Array.from(documentDoc.getElementsByTagName("*"))) {
    if (xmlLocalName(node) !== "blip") continue
    const relId = docxImageEmbedId(node)
    if (!relId) continue
    const rel = rels.get(relId)
    if (!rel || rel.targetMode === "External") continue

    const mediaPath = resolveDocxPartPath(documentPartPath, rel.target)
    const mediaFile = zip.file(mediaPath)
    if (!mediaFile) continue

    const base64 = await mediaFile.async("base64")
    const mime = imageMimeTypeFromBase64(base64) ?? imageMimeTypeFromPath(mediaPath) ?? "application/octet-stream"
    dataUrls.push(`data:${mime};base64,${base64}`)
  }

  return dataUrls
}

function setDocxTextNodeValue(node: Element, value: string) {
  node.textContent = value
  if (/^\s|\s$/.test(value)) {
    node.setAttribute("xml:space", "preserve")
  } else {
    node.removeAttribute("xml:space")
  }
}

function docxTextSpans(doc: Document) {
  const spans: Array<{ node: Element; start: number; end: number; text: string }> = []
  let text = ""

  const appendTextNode = (node: Element) => {
    const value = node.textContent ?? ""
    const start = text.length
    text += value
    spans.push({ node, start, end: text.length, text: value })
  }

  const appendWordText = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (!(child instanceof Element)) continue
      const childName = xmlLocalName(child)
      if (childName === "t") {
        appendTextNode(child)
        continue
      }
      if (childName === "tab") {
        text += "\t"
        continue
      }
      if (childName === "br" || childName === "cr") {
        text += "\n"
        continue
      }
      appendWordText(child)
    }
  }

  const body = docxBody(doc) ?? doc.documentElement
  const paragraphs = Array.from(body.getElementsByTagName("*")).filter((node) => xmlLocalName(node) === "p")
  if (paragraphs.length === 0) {
    appendWordText(body)
    return { text, spans }
  }

  for (const [index, paragraph] of paragraphs.entries()) {
    appendWordText(paragraph)
    if (index < paragraphs.length - 1) text += "\n"
  }
  return { text, spans }
}

function nearestDocxAncestor(node: Node, localName: string) {
  let current: Node | null = node
  while (current) {
    if (current instanceof Element && xmlLocalName(current) === localName) return current
    current = current.parentNode
  }
}

function docxBody(doc: Document) {
  return Array.from(doc.getElementsByTagName("*")).find((node) => xmlLocalName(node) === "body")
}

function parseXmlDocument(xml: string) {
  return new DOMParser().parseFromString(xml, "application/xml")
}

function serializeXmlDocument(doc: Document) {
  return new XMLSerializer().serializeToString(doc)
}

function ensureDocxNamespace(doc: Document, prefix: keyof typeof DOCX_NS) {
  const root = doc.documentElement
  if (!root) return
  const attrName = `xmlns:${prefix}`
  if (root.getAttribute(attrName) === DOCX_NS[prefix]) return
  root.setAttribute(attrName, DOCX_NS[prefix])
}

export async function docxPlainTextFromBase64(docxBase64: string): Promise<string> {
  const JSZip = (await import("jszip")).default
  const zip = await JSZip.loadAsync(docxBase64, { base64: true })
  const documentPart = zip.file("word/document.xml")
  if (!documentPart) return ""

  const xmlText = await documentPart.async("text")
  const doc = parseXmlDocument(xmlText)
  return docxTextSpans(doc).text
}

function docxImageEmbedId(node: Element) {
  return (
    node.getAttributeNS(DOCX_NS.r, "embed") ??
    node.getAttribute("r:embed") ??
    Array.from(node.attributes).find((attr) => xmlLocalName(attr) === "embed")?.value ??
    null
  )
}

export async function docxBufferForPreview(input: ArrayBuffer): Promise<ArrayBuffer> {
  const JSZip = (await import("jszip")).default
  const zip = await JSZip.loadAsync(input)
  const documentPart = zip.file("word/document.xml")
  if (!documentPart) return input

  const xmlText = await documentPart.async("text")
  const doc = parseXmlDocument(xmlText)
  let changed = false

  for (const node of Array.from(doc.getElementsByTagName("*"))) {
    if (xmlLocalName(node) !== "blip") continue
    const relId = docxImageEmbedId(node)
    if (!relId || node.getAttribute("embed") === relId) continue
    node.setAttribute("embed", relId)
    changed = true
  }

  if (!changed) return input
  zip.file("word/document.xml", serializeXmlDocument(doc))
  return zip.generateAsync({ type: "arraybuffer" })
}

const DOCX_NS = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
}

function appendDocxElement(
  parent: Element,
  namespace: string,
  qualifiedName: string,
  attributes?: Record<string, string | number>,
) {
  const child = parent.ownerDocument.createElementNS(namespace, qualifiedName)
  for (const [key, value] of Object.entries(attributes ?? {})) child.setAttribute(key, String(value))
  parent.appendChild(child)
  return child
}

function nextDocxNumericId(doc: Document, localName: string, attribute: string) {
  const used = new Set<number>()
  for (const node of Array.from(doc.getElementsByTagName("*"))) {
    if (xmlLocalName(node) !== localName) continue
    const value = Number(node.getAttribute(attribute))
    if (Number.isInteger(value) && value > 0) used.add(value)
  }
  let next = 1
  while (used.has(next)) next++
  return next
}

function nextDocxRelationshipId(relsDoc: Document) {
  const existing = new Set(
    Array.from(relsDoc.getElementsByTagName("*"))
      .filter((node) => xmlLocalName(node) === "Relationship")
      .map((node) => node.getAttribute("Id"))
      .filter((id): id is string => !!id),
  )
  let next = 1
  while (existing.has(`rId${next}`)) next++
  return `rId${next}`
}

function uniqueDocxMediaName(zip: { file(path: string): unknown }, caption: string) {
  const safeCaption = caption
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/[^\w.-]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  const base = `parvis-chart-${Date.now()}-${safeCaption || "chart"}`
  let index = 0
  while (true) {
    const name = `${base}${index === 0 ? "" : `-${index}`}.png`
    if (!zip.file(`word/media/${name}`)) return name
    index++
  }
}

function docxMediaExtension(path: string) {
  const extension = path.split(/[?#]/, 1)[0]?.split(".").pop()?.toLowerCase()
  if (extension && /^[a-z0-9]+$/.test(extension)) return extension
  return "png"
}

function docxTargetHasUnsafeMediaName(target: string) {
  const name = target.split("/").pop() ?? target
  return !/^[A-Za-z0-9._-]+$/.test(name)
}

function uniqueAsciiDocxMediaName(zip: { file(path: string): unknown }, extension: string, index: number) {
  let suffix = index
  while (true) {
    const name = `parvis-chart-${Date.now()}-${suffix}.${extension}`
    if (!zip.file(`word/media/${name}`)) return name
    suffix++
  }
}

export async function normalizeDocxForWordSave(docxBase64: string): Promise<string> {
  const JSZip = (await import("jszip")).default
  const zip = await JSZip.loadAsync(docxBase64, { base64: true })
  const relsPath = "word/_rels/document.xml.rels"
  const relsPart = zip.file(relsPath)
  if (!relsPart) return docxBase64

  const relsDoc = parseXmlDocument(await relsPart.async("text"))
  let changed = false
  let mediaIndex = 1

  for (const relationship of Array.from(relsDoc.getElementsByTagName("*"))) {
    if (xmlLocalName(relationship) !== "Relationship") continue
    if (relationship.getAttribute("Type") !== "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image") {
      continue
    }
    if (relationship.getAttribute("TargetMode") === "External") continue
    const target = relationship.getAttribute("Target")
    if (!target || !target.includes("parvis-chart-") || !docxTargetHasUnsafeMediaName(target)) continue

    const mediaPath = resolveDocxPartPath("word/document.xml", target)
    const mediaFile = zip.file(mediaPath)
    if (!mediaFile) continue

    const extension = docxMediaExtension(mediaPath)
    const nextName = uniqueAsciiDocxMediaName(zip, extension, mediaIndex++)
    zip.file(`word/media/${nextName}`, await mediaFile.async("uint8array"))
    zip.remove(mediaPath)
    relationship.setAttribute("Target", `media/${nextName}`)
    changed = true
  }

  if (!changed) return docxBase64
  zip.file(relsPath, serializeXmlDocument(relsDoc))
  return zip.generateAsync({ type: "base64" })
}

async function addDocxImageRelationship(zip: {
  file(path: string): { async(type: "text"): Promise<string> } | null
  file(path: string, data: string): unknown
}, mediaName: string) {
  const relsPath = "word/_rels/document.xml.rels"
  const relsPart = zip.file(relsPath)
  const relsDoc = parseXmlDocument(
    relsPart
      ? await relsPart.async("text")
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
  )
  const relId = nextDocxRelationshipId(relsDoc)
  const root = relsDoc.documentElement
  const relationship = relsDoc.createElementNS("http://schemas.openxmlformats.org/package/2006/relationships", "Relationship")
  relationship.setAttribute("Id", relId)
  relationship.setAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image")
  relationship.setAttribute("Target", `media/${mediaName}`)
  root.appendChild(relationship)
  zip.file(relsPath, serializeXmlDocument(relsDoc))
  return relId
}

async function ensureDocxPngContentType(zip: {
  file(path: string): { async(type: "text"): Promise<string> } | null
  file(path: string, data: string): unknown
}) {
  const contentTypesPath = "[Content_Types].xml"
  const contentTypesPart = zip.file(contentTypesPath)
  const contentTypesDoc = parseXmlDocument(
    contentTypesPart
      ? await contentTypesPart.async("text")
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
  )
  const hasPngDefault = Array.from(contentTypesDoc.getElementsByTagName("*")).some(
    (node) => xmlLocalName(node) === "Default" && node.getAttribute("Extension")?.toLowerCase() === "png",
  )
  if (hasPngDefault) return

  const defaultNode = contentTypesDoc.createElementNS(
    "http://schemas.openxmlformats.org/package/2006/content-types",
    "Default",
  )
  defaultNode.setAttribute("Extension", "png")
  defaultNode.setAttribute("ContentType", "image/png")
  contentTypesDoc.documentElement.appendChild(defaultNode)
  zip.file(contentTypesPath, serializeXmlDocument(contentTypesDoc))
}

function createDocxImageParagraph(doc: Document, input: {
  relId: string
  caption: string
  docPrId: number
  cNvPrId: number
  cx: number
  cy: number
}) {
  ensureDocxNamespace(doc, "r")
  ensureDocxNamespace(doc, "wp")
  ensureDocxNamespace(doc, "a")
  ensureDocxNamespace(doc, "pic")

  const name = (input.caption || "图表").trim().slice(0, 80) || "图表"
  const paragraph = doc.createElementNS(DOCX_NS.w, "w:p")
  const run = appendDocxElement(paragraph, DOCX_NS.w, "w:r")
  const drawing = appendDocxElement(run, DOCX_NS.w, "w:drawing")
  const inline = appendDocxElement(drawing, DOCX_NS.wp, "wp:inline", {
    distT: 0,
    distB: 0,
    distL: 0,
    distR: 0,
  })
  appendDocxElement(inline, DOCX_NS.wp, "wp:extent", { cx: input.cx, cy: input.cy })
  appendDocxElement(inline, DOCX_NS.wp, "wp:effectExtent", { l: 0, t: 0, r: 0, b: 0 })
  appendDocxElement(inline, DOCX_NS.wp, "wp:docPr", { id: input.docPrId, name, descr: name })
  const frame = appendDocxElement(inline, DOCX_NS.wp, "wp:cNvGraphicFramePr")
  appendDocxElement(frame, DOCX_NS.a, "a:graphicFrameLocks", { noChangeAspect: 1 })
  const graphic = appendDocxElement(inline, DOCX_NS.a, "a:graphic")
  const graphicData = appendDocxElement(graphic, DOCX_NS.a, "a:graphicData", { uri: DOCX_NS.pic })
  const picture = appendDocxElement(graphicData, DOCX_NS.pic, "pic:pic")
  const nonVisual = appendDocxElement(picture, DOCX_NS.pic, "pic:nvPicPr")
  appendDocxElement(nonVisual, DOCX_NS.pic, "pic:cNvPr", { id: input.cNvPrId, name })
  appendDocxElement(nonVisual, DOCX_NS.pic, "pic:cNvPicPr")
  const blipFill = appendDocxElement(picture, DOCX_NS.pic, "pic:blipFill")
  const blip = appendDocxElement(blipFill, DOCX_NS.a, "a:blip")
  blip.setAttributeNS(DOCX_NS.r, "r:embed", input.relId)
  const stretch = appendDocxElement(blipFill, DOCX_NS.a, "a:stretch")
  appendDocxElement(stretch, DOCX_NS.a, "a:fillRect")
  const shapeProperties = appendDocxElement(picture, DOCX_NS.pic, "pic:spPr")
  const transform = appendDocxElement(shapeProperties, DOCX_NS.a, "a:xfrm")
  appendDocxElement(transform, DOCX_NS.a, "a:off", { x: 0, y: 0 })
  appendDocxElement(transform, DOCX_NS.a, "a:ext", { cx: input.cx, cy: input.cy })
  const geometry = appendDocxElement(shapeProperties, DOCX_NS.a, "a:prstGeom", { prst: "rect" })
  appendDocxElement(geometry, DOCX_NS.a, "a:avLst")
  return paragraph
}

export async function replaceDocxSelectionText(
  docxBase64: string,
  selection: PreviewTextSelection,
  replacement: string,
): Promise<{ ok: true; base64: string } | { ok: false; reason: "not_found" | "ambiguous" }> {
  const JSZip = (await import("jszip")).default
  const zip = await JSZip.loadAsync(docxBase64, { base64: true })
  const documentPart = zip.file("word/document.xml")
  if (!documentPart) return { ok: false, reason: "not_found" }

  const xmlText = await documentPart.async("text")
  const doc = parseXmlDocument(xmlText)
  const { text, spans } = docxTextSpans(doc)

  const exact = locateSelection(text, selection)
  const located = exact.ok ? exact : locateSelectionWithCollapsedWhitespace(text, selection)
  if (!located.ok) return located

  let replacementInserted = false
  for (const span of spans) {
    if (span.end <= located.start || span.start >= located.end) continue
    const overlapStart = Math.max(located.start, span.start)
    const overlapEnd = Math.min(located.end, span.end)
    const before = span.text.slice(0, overlapStart - span.start)
    const after = span.text.slice(overlapEnd - span.start)

    if (!replacementInserted) {
      const value = before + replacement + (located.end <= span.end ? after : "")
      setDocxTextNodeValue(span.node, value)
      replacementInserted = true
      continue
    }

    setDocxTextNodeValue(span.node, located.end <= span.end ? after : "")
  }

  zip.file("word/document.xml", serializeXmlDocument(doc))
  return {
    ok: true,
    base64: await zip.generateAsync({ type: "base64" }),
  }
}

export async function insertDocxChartAfterSelection(
  docxBase64: string,
  selection: PreviewTextSelection,
  pngBase64: string,
  caption: string,
): Promise<{ ok: true; base64: string } | { ok: false; reason: "not_found" | "ambiguous" }> {
  const JSZip = (await import("jszip")).default
  const zip = await JSZip.loadAsync(docxBase64, { base64: true })
  const documentPart = zip.file("word/document.xml")
  if (!documentPart) return { ok: false, reason: "not_found" }

  const xmlText = await documentPart.async("text")
  const doc = parseXmlDocument(xmlText)
  const { text, spans } = docxTextSpans(doc)
  const exact = locateSelection(text, selection)
  const located = exact.ok ? exact : locateSelectionWithCollapsedWhitespace(text, selection)
  if (!located.ok) return located

  const endSpan =
    spans.find((span) => span.start < located.end && located.end <= span.end) ??
    spans.find((span) => span.start <= located.end && located.end <= span.end)
  const anchorParagraph = endSpan ? nearestDocxAncestor(endSpan.node, "p") : undefined
  const body = docxBody(doc)
  if (!anchorParagraph && !body) return { ok: false, reason: "not_found" }

  const mediaName = uniqueDocxMediaName(zip, caption)
  zip.file(`word/media/${mediaName}`, pngBase64, { base64: true })
  const relId = await addDocxImageRelationship(zip, mediaName)
  await ensureDocxPngContentType(zip)

  const cx = 5943600
  const cy = 3657600
  const docPrId = nextDocxNumericId(doc, "docPr", "id")
  const cNvPrId = nextDocxNumericId(doc, "cNvPr", "id")
  const imageParagraph = createDocxImageParagraph(doc, { relId, caption, docPrId, cNvPrId, cx, cy })

  if (anchorParagraph?.parentNode) {
    anchorParagraph.parentNode.insertBefore(imageParagraph, anchorParagraph.nextSibling)
  } else if (body) {
    const sectPr = Array.from(body.childNodes).find(
      (node): node is Element => node instanceof Element && xmlLocalName(node) === "sectPr",
    )
    body.insertBefore(imageParagraph, sectPr ?? null)
  }

  zip.file("word/document.xml", serializeXmlDocument(doc))
  return {
    ok: true,
    base64: await zip.generateAsync({ type: "base64" }),
  }
}
