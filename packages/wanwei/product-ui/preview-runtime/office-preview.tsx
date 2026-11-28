/* oxlint-disable -- Parvis source retained with its original control flow and types; see preview-runtime/LICENSE. */
import { batch, Component, createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import type { FileContent } from "@opencode-ai/sdk/v2"
import * as pdfjs from "pdfjs-dist"
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url"
import "pdfjs-dist/web/pdf_viewer.css"
import {
  docxBufferForPreview,
  docxImageDataUrlsForPreview,
  docxPlainTextFromBase64,
  imageBlobUrlFromDataUrl,
  selectionSnapshotFromDragText,
  selectionSnapshotFromPoints,
  selectionSnapshotFromTextAndRect,
  selectionSnapshotFromTextAndPoint,
  selectionSnapshotFromWindow,
  type PreviewTextSelection,
} from "@/utils/preview-edit"
import { PreviewShell, PreviewZoomControls } from "@/components/session/preview-shell"
import { PptxRenderer } from "@/components/session/pptx-preview"
import { XlsxRenderer } from "@/components/session/xlsx-preview"

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const pdfjsAssetBase = `${import.meta.env.BASE_URL || "/"}`.replace(/\/?$/, "/") + "pdfjs/"
const pdfjsDocumentOptions = {
  cMapUrl: `${pdfjsAssetBase}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${pdfjsAssetBase}standard_fonts/`,
  wasmUrl: `${pdfjsAssetBase}wasm/`,
  useWorkerFetch: false,
}

function readableStreamAsyncIterator(stream: ReadableStream<unknown>, preventCancel = false) {
  const reader = stream.getReader()
  let finished = false
  const releaseLock = () => {
    try {
      reader.releaseLock()
    } catch {
      // Some WebKit builds throw if the lock was already released after cancel/read completion.
    }
  }

  const iterator: AsyncIterator<unknown> & AsyncIterable<unknown> = {
    async next() {
      if (finished) return { done: true, value: undefined }
      const result = await reader.read()
      if (result.done) {
        finished = true
        releaseLock()
        return { done: true, value: undefined }
      }
      return { done: false, value: result.value }
    },
    async return() {
      finished = true
      if (!preventCancel) await reader.cancel().catch(() => undefined)
      releaseLock()
      return { done: true, value: undefined }
    },
    [Symbol.asyncIterator]() {
      return iterator
    },
  }

  return iterator
}

function installPdfjsWebKitPolyfills() {
  const responsePrototype = globalThis.Response?.prototype as
    | (typeof Response.prototype & { bytes?: () => Promise<Uint8Array> })
    | undefined
  if (responsePrototype && typeof responsePrototype.bytes !== "function") {
    Object.defineProperty(responsePrototype, "bytes", {
      configurable: true,
      value: async function bytes(this: Response) {
        return new Uint8Array(await this.arrayBuffer())
      },
    })
  }

  const readableStreamPrototype = globalThis.ReadableStream?.prototype as
    | (typeof ReadableStream.prototype & {
        [Symbol.asyncIterator]?: () => AsyncIterator<unknown>
        values?: (options?: { preventCancel?: boolean }) => AsyncIterator<unknown>
      })
    | undefined
  if (readableStreamPrototype) {
    const defineReadableStreamMethod = (key: PropertyKey, value: unknown) => {
      try {
        Object.defineProperty(readableStreamPrototype, key, {
          configurable: true,
          writable: true,
          value,
        })
      } catch {
        try {
          ;(readableStreamPrototype as any)[key] = value
        } catch {
          // Leave the native implementation in place if WebKit marks it as non-configurable.
        }
      }
    }

    defineReadableStreamMethod(Symbol.asyncIterator, function asyncIterator(this: ReadableStream<unknown>) {
      return readableStreamAsyncIterator(this)
    })
    defineReadableStreamMethod("values", function values(
      this: ReadableStream<unknown>,
      options?: { preventCancel?: boolean },
    ) {
      return readableStreamAsyncIterator(this, options?.preventCancel === true)
    })
  }
}

installPdfjsWebKitPolyfills()

type PdfTextItem = {
  pageNumber: number
  index: number
  scale: number
  pageWidth: number
  pageHeight: number
  text: string
  x: number
  y: number
  width: number
  height: number
}

type PdfSelectionRect = {
  x: number
  y: number
  width: number
  height: number
}

type PdfTextRow = {
  y: number
  height: number
  items: PdfTextItem[]
}

const PDF_INITIAL_RENDER_PAGE_COUNT = 2
const PDF_RENDER_OVERSCAN_PX = 2400
const PDF_RENDER_NEIGHBOR_PAGE_COUNT = 2
const PDF_MAX_CANVAS_OUTPUT_SCALE = 1.5
const PDF_TEXT_EXTRACTION_DELAY_MS = 80
const PDF_ROW_LOOKBACK_COUNT = 6
const PDF_TEXT_ITEM_INDEX_MULTIPLIER = 100000

const pdfGraphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function fixDocxImageMime(root: Document | HTMLElement) {
  const prefix = "data:application/octet-stream;base64,"
  const imgs = root.querySelectorAll("img")
  for (const img of Array.from(imgs)) {
    const src = img.getAttribute("src") || ""
    if (!src.startsWith(prefix)) continue
    const b64 = src.slice(prefix.length)
    let head: Uint8Array
    try {
      const bin = atob(b64.slice(0, 16))
      head = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) head[i] = bin.charCodeAt(i)
    } catch {
      continue
    }

    let mime: string | null = null
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) mime = "image/png"
    else if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) mime = "image/jpeg"
    else if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) mime = "image/gif"
    else if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46) mime = "image/webp"
    else {
      const text = String.fromCharCode(...head).trim()
      if (text.startsWith("<")) mime = "image/svg+xml"
    }
    if (mime) img.setAttribute("src", `data:${mime};base64,${b64}`)
  }
}

const DocxRenderer: Component<{
  buffer: ArrayBuffer
  source: string
  onSelectionChange?: (selection: PreviewTextSelection | undefined) => void
  onSelectionContextMenu?: (selection: PreviewTextSelection | undefined, menu: { x: number; y: number }) => boolean | void
}> = (props) => {
  let hostRef: HTMLDivElement | undefined
  let shadowRoot: ShadowRoot | undefined
  let docxContainer: HTMLDivElement | undefined
  let resizeObserver: ResizeObserver | undefined
  let cleanupSelectionListeners: VoidFunction | undefined
  let cleanupImageSources: VoidFunction | undefined
  let resizeFrame: number | undefined
  let imageObjectUrls: string[] = []
  let lastSelection: PreviewTextSelection | undefined
  let lastSelectionAt = 0
  let dragStartPoint: { x: number; y: number } | undefined
  let suppressEmptySelectionUntil = 0
  const [error, setError] = createSignal<string>()
  const [loading, setLoading] = createSignal(true)

  const currentDocxSelectedText = () => {
    const shadowSelection = (shadowRoot as unknown as { getSelection?: () => Selection | null } | undefined)
      ?.getSelection?.()
      ?.toString?.()
    const windowSelection = window.getSelection?.()?.toString?.()
    const text = shadowSelection || windowSelection || ""
    return text.trim() ? text : ""
  }

  const docxSelectionFromDragRect = (endPoint: { x: number; y: number }) => {
    if (!docxContainer || !dragStartPoint) return
    const left = Math.min(dragStartPoint.x, endPoint.x)
    const right = Math.max(dragStartPoint.x, endPoint.x)
    const top = Math.min(dragStartPoint.y, endPoint.y)
    const bottom = Math.max(dragStartPoint.y, endPoint.y)
    if (right - left < 2 && bottom - top < 2) return

    const walker = document.createTreeWalker(docxContainer, NodeFilter.SHOW_TEXT)
    const pieces: string[] = []
    let unionLeft = Number.POSITIVE_INFINITY
    let unionTop = Number.POSITIVE_INFINITY
    let unionRight = Number.NEGATIVE_INFINITY
    let unionBottom = Number.NEGATIVE_INFINITY

    const intersectsDrag = (rect: DOMRect | ClientRect) =>
      rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom

    while (walker.nextNode()) {
      const node = walker.currentNode
      const text = node.textContent ?? ""
      if (!text.trim()) continue

      const range = document.createRange()
      range.selectNodeContents(node)
      const rects = Array.from(range.getClientRects()).filter(intersectsDrag)
      if (rects.length === 0) continue

      pieces.push(text)
      for (const rect of rects) {
        unionLeft = Math.min(unionLeft, rect.left)
        unionTop = Math.min(unionTop, rect.top)
        unionRight = Math.max(unionRight, rect.right)
        unionBottom = Math.max(unionBottom, rect.bottom)
      }
    }

    const selectedText = pieces.join("")
    if (!selectedText.trim() || !Number.isFinite(unionLeft) || !Number.isFinite(unionTop)) return

    return selectionSnapshotFromTextAndRect({
      selectedText,
      rect: new DOMRect(unionLeft, unionTop, unionRight - unionLeft, unionBottom - unionTop),
      source: props.source,
    })
  }

  const docxSelection = (menu?: { x: number; y: number }, forceMenuPoint = false) => {
    if (!hostRef) return
    let selection: PreviewTextSelection | undefined
    try {
      selection = selectionSnapshotFromWindow(hostRef, props.source)
    } catch {
      selection = undefined
    }
    if (selection) return menu && forceMenuPoint ? { ...selection, menu } : selection
    if (!menu || forceMenuPoint || !dragStartPoint) return selection
    try {
      return (
        selectionSnapshotFromPoints(hostRef, props.source, dragStartPoint, menu) ??
        selectionSnapshotFromDragText(hostRef, props.source, dragStartPoint, menu) ??
        docxSelectionFromDragRect(menu)
      )
    } catch {
      return selectionSnapshotFromDragText(hostRef, props.source, dragStartPoint, menu) ?? docxSelectionFromDragRect(menu)
    }
  }

  const selectionForMenu = (menu: { x: number; y: number }) => {
    const selectedText = currentDocxSelectedText() || lastSelection?.selectedText || ""
    const selection =
      docxSelection(menu, true) ??
      selectionSnapshotFromTextAndPoint({
        selectedText,
        source: props.source,
        x: menu.x,
        y: menu.y,
      }) ??
      (lastSelection && Date.now() - lastSelectionAt < 2000 ? { ...lastSelection, menu } : undefined)
    if (selection) {
      lastSelection = selection
      lastSelectionAt = Date.now()
    }
    return selection
  }

  const emitSelection = (point?: { x: number; y: number }) => {
    const selection = docxSelection(point)
    if (selection) {
      lastSelection = selection
      lastSelectionAt = Date.now()
      props.onSelectionChange?.(selection)
      return
    }

    if (point) return
    if (lastSelection && (currentDocxSelectedText() || Date.now() < suppressEmptySelectionUntil)) return
    props.onSelectionChange?.(undefined)
  }

  const emitSelectionSoon = (event: Event) => {
    const point =
      event instanceof MouseEvent
        ? {
            x: event.clientX,
            y: event.clientY,
          }
        : undefined
    requestAnimationFrame(() => emitSelection(point))
  }

  const emitKeyboardSelection = () => emitSelection()

  const cacheSelection = () => {
    const selection = docxSelection()
    if (!selection) return
    lastSelection = selection
    lastSelectionAt = Date.now()
  }

  const emitContextMenu = (event: MouseEvent) => {
    const menu = {
      x: event.clientX,
      y: event.clientY,
    }
    const selection = selectionForMenu(menu)
    if (!selection) return
    suppressEmptySelectionUntil = Date.now() + 800
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    props.onSelectionContextMenu?.(selection, menu)
  }

  const emitSecondaryMouseDown = (event: MouseEvent) => {
    if (event.button === 0) {
      dragStartPoint = { x: event.clientX, y: event.clientY }
      return
    }
    if (event.button === 2) emitContextMenu(event)
  }
  const emitShadowMouseDown = (event: Event) => {
    if (event instanceof MouseEvent) emitSecondaryMouseDown(event)
  }
  const emitShadowContextMenu = (event: Event) => {
    if (event instanceof MouseEvent) emitContextMenu(event)
  }

  const injectDocxPreviewOverrides = (container: HTMLElement) => {
    container.querySelector("#parvis-docx-preview-overrides")?.remove()
    const style = document.createElement("style")
    style.id = "parvis-docx-preview-overrides"
    style.textContent = `
      :host {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        background: #fff !important;
        -webkit-user-select: text !important;
        user-select: text !important;
        cursor: text !important;
      }
      #docx-container {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        min-height: 100% !important;
        overflow-x: hidden !important;
        background: #fff !important;
        -webkit-user-select: text !important;
        user-select: text !important;
        cursor: text !important;
      }
      .docx-wrapper,
      .docx-preview-wrapper {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        box-sizing: border-box !important;
        overflow-x: hidden !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        background: #fff !important;
        padding: 16px !important;
        -webkit-user-select: text !important;
        user-select: text !important;
      }
      .parvis-docx-page-frame {
        position: relative !important;
        flex: 0 0 auto !important;
        margin: 0 auto 16px auto !important;
        overflow: visible !important;
        -webkit-user-select: text !important;
        user-select: text !important;
      }
      .docx-wrapper > section,
      .docx-preview-wrapper > section,
      .parvis-docx-page-frame > section,
      section.docx,
      section.docx-preview {
        flex: 0 0 auto !important;
        max-width: none !important;
        margin: 0 !important;
        transform: scale(var(--docx-page-scale, 1)) !important;
        transform-origin: top left !important;
        -webkit-user-select: text !important;
        user-select: text !important;
        cursor: text !important;
      }
      .parvis-docx-page-frame > section {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
      }
      #docx-container *,
      section.docx *,
      section.docx-preview * {
        -webkit-user-select: text !important;
        user-select: text !important;
      }
    `
    container.appendChild(style)
  }

  const ensureDocxPageFrames = (container: ParentNode) => {
    const pages = Array.from(container.querySelectorAll<HTMLElement>("section.docx-preview, section.docx"))
    return pages.map((page) => {
      const parent = page.parentElement
      if (parent?.classList.contains("parvis-docx-page-frame")) return { frame: parent, page }

      const frame = document.createElement("div")
      frame.className = "parvis-docx-page-frame"
      parent?.insertBefore(frame, page)
      frame.appendChild(page)
      return { frame, page }
    })
  }

  const normalizeDocxPreviewImageSources = (container: ParentNode, imageDataUrls: string[]) => {
    const images = Array.from(container.querySelectorAll<HTMLImageElement>("img"))
    for (const [index, image] of images.entries()) {
      const src = image.getAttribute("src")
      if (src?.startsWith("blob:")) continue
      const source = imageDataUrls[index] ?? src
      if (!source) continue
      const objectUrl = imageBlobUrlFromDataUrl(source)
      if (!objectUrl) continue
      imageObjectUrls.push(objectUrl)
      image.setAttribute("src", objectUrl)
    }
  }

  createEffect(async () => {
    if (!hostRef) return
    const buffer = props.buffer
    let cancelled = false
    let normalizeFrame: number | undefined
    let normalizeTimers: number[] = []
    onCleanup(() => {
      cancelled = true
      if (normalizeFrame !== undefined) cancelAnimationFrame(normalizeFrame)
      for (const timer of normalizeTimers) window.clearTimeout(timer)
      cleanupImageSources?.()
      cleanupImageSources = undefined
      for (const objectUrl of imageObjectUrls) URL.revokeObjectURL(objectUrl)
      imageObjectUrls = []
    })
    resizeObserver?.disconnect()
    cleanupSelectionListeners?.()
    cleanupSelectionListeners = undefined
    cleanupImageSources?.()
    cleanupImageSources = undefined
    for (const objectUrl of imageObjectUrls) URL.revokeObjectURL(objectUrl)
    imageObjectUrls = []
    setLoading(true)
    try {
      const { renderAsync } = await import("docx-preview")
      if (cancelled) return
      const previewBuffer = await docxBufferForPreview(buffer)
      if (cancelled) return
      const imageDataUrls = await docxImageDataUrlsForPreview(previewBuffer)
      if (cancelled) return

      shadowRoot = hostRef.shadowRoot ?? hostRef.attachShadow({ mode: "open" })
      shadowRoot.textContent = ""
      const container = document.createElement("div")
      container.id = "docx-container"
      shadowRoot.appendChild(container)
      docxContainer = container

      // Render inside a ShadowRoot so docx styles stay isolated while contextmenu events remain in the main WebView.
      await renderAsync(previewBuffer, container, container, {
        className: "docx-preview",
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: true,
        ignoreFonts: false,
        breakPages: true,
        useBase64URL: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
      })
      if (cancelled) return
      const normalizeImages = () => {
        if (!cancelled) {
          normalizeDocxPreviewImageSources(container, imageDataUrls)
          fixDocxImageMime(container)
        }
      }
      const imageObserver = new MutationObserver(normalizeImages)
      imageObserver.observe(container, {
        attributeFilter: ["src"],
        attributes: true,
        childList: true,
        subtree: true,
      })
      cleanupImageSources = () => imageObserver.disconnect()
      normalizeImages()
      normalizeFrame = requestAnimationFrame(normalizeImages)
      normalizeTimers = [100, 500, 1500].map((delay) => window.setTimeout(normalizeImages, delay))
      injectDocxPreviewOverrides(container)
      shadowRoot.addEventListener("mouseup", emitSelectionSoon)
      shadowRoot.addEventListener("keyup", emitKeyboardSelection)
      shadowRoot.addEventListener("mousedown", emitShadowMouseDown, true)
      shadowRoot.addEventListener("contextmenu", emitShadowContextMenu, true)
      document.addEventListener("selectionchange", cacheSelection)
      cleanupSelectionListeners = () => {
        shadowRoot?.removeEventListener("mouseup", emitSelectionSoon)
        shadowRoot?.removeEventListener("keyup", emitKeyboardSelection)
        shadowRoot?.removeEventListener("mousedown", emitShadowMouseDown, true)
        shadowRoot?.removeEventListener("contextmenu", emitShadowContextMenu, true)
        document.removeEventListener("selectionchange", cacheSelection)
      }

      const resize = () => {
        const host = hostRef
        const rendered = docxContainer
        if (!host || !rendered) return

        const pages = ensureDocxPageFrames(rendered)
        const viewportWidth = host.clientWidth
        const availableWidth = Math.max(240, viewportWidth - 32)
        for (const { frame, page } of pages) {
          const pageWidth = page.offsetWidth || page.scrollWidth
          const pageHeight = page.offsetHeight || page.scrollHeight
          const scale = pageWidth > availableWidth ? Math.max(0.25, availableWidth / pageWidth) : 1
          page.style.setProperty("--docx-page-scale", String(scale))
          frame.style.width = `${Math.ceil(pageWidth * scale)}px`
          frame.style.height = `${Math.ceil(pageHeight * scale)}px`
        }
      }
      const scheduleResize = () => {
        if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = undefined
          resize()
        })
      }

      setLoading(false)
      resizeObserver = new ResizeObserver(scheduleResize)
      resizeObserver.observe(hostRef)
      resizeObserver.observe(container)
      requestAnimationFrame(scheduleResize)
      setTimeout(scheduleResize, 100)
      setTimeout(scheduleResize, 500)
      document.fonts?.ready.then(scheduleResize).catch(() => {})
    } catch (e) {
      setError(e instanceof Error ? e.message : "文档渲染失败")
      setLoading(false)
    }
  })

  onCleanup(() => {
    cleanupSelectionListeners?.()
    resizeObserver?.disconnect()
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
  })

  return (
    <Switch>
      <Match when={error()}>
        <div class="px-6 py-4 text-text-weak">{error()}</div>
      </Match>
      <Match when={true}>
        <div class="relative min-h-full bg-white">
          <Show when={loading()}>
            <div class="absolute left-0 top-0 px-6 py-4 text-text-weak">正在加载文档...</div>
          </Show>
          <div
            ref={hostRef}
            class="block min-h-[600px] min-w-0 w-full bg-white select-text cursor-text"
            style={{ display: loading() ? "none" : "block" }}
          />
        </div>
      </Match>
    </Switch>
  )
}

const PdfPageRenderer: Component<{
  document: () => any
  pageNumber: number
  zoom: number
  shouldRender: boolean
  textItems?: PdfTextItem[]
  selectionRects?: PdfSelectionRect[]
  onTextItems: (pageNumber: number, items: PdfTextItem[]) => void
}> = (props) => {
  let pageRef: HTMLDivElement | undefined
  let canvasRef: HTMLCanvasElement | undefined
  let textLayerRef: HTMLDivElement | undefined

  const applyPageLayout = (viewport: any) => {
    const pageDiv = pageRef
    const canvas = canvasRef
    const textLayerDiv = textLayerRef
    if (!pageDiv || !canvas || !textLayerDiv) return

    const width = Math.ceil(viewport.width)
    const height = Math.ceil(viewport.height)
    pageDiv.style.width = `${width}px`
    pageDiv.style.height = `${height}px`
    pageDiv.style.setProperty("--total-scale-factor", String(props.zoom))
    pageDiv.style.setProperty("--scale-round-x", "1px")
    pageDiv.style.setProperty("--scale-round-y", "1px")
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    canvas.style.position = "absolute"
    canvas.style.left = "0"
    canvas.style.top = "0"
    canvas.style.zIndex = "1"
    textLayerDiv.style.width = `${width}px`
    textLayerDiv.style.height = `${height}px`
    textLayerDiv.style.setProperty("--total-scale-factor", String(props.zoom))
    textLayerDiv.style.setProperty("--scale-round-x", "1px")
    textLayerDiv.style.setProperty("--scale-round-y", "1px")
    return { width, height }
  }

  createEffect(() => {
    const document = props.document()
    const zoom = props.zoom
    const pageDiv = pageRef
    if (!document || !pageDiv) return

    let cancelled = false

    void (async () => {
      const page = await document.getPage(props.pageNumber)
      if (cancelled) return
      applyPageLayout(page.getViewport({ scale: zoom }))
    })().catch((error) => {
      if (!cancelled) console.error("[PdfRenderer] page layout failed:", error)
    })

    onCleanup(() => {
      cancelled = true
    })
  })

  createEffect(() => {
    const document = props.document()
    const zoom = props.zoom
    const shouldRender = props.shouldRender
    const pageDiv = pageRef
    const canvas = canvasRef
    const textLayerDiv = textLayerRef
    if (!document || !pageDiv || !canvas || !textLayerDiv || !shouldRender) return

    let cancelled = false
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | undefined
    let textContentTimeout: number | undefined

    void (async () => {
      const page = await document.getPage(props.pageNumber)
      if (cancelled) return

      const viewport = page.getViewport({ scale: zoom })
      const layout = applyPageLayout(viewport)
      if (!layout) return
      const { width, height } = layout
      const outputScale = Math.min(PDF_MAX_CANVAS_OUTPUT_SCALE, Math.max(1, window.devicePixelRatio || 1))
      const renderCanvas = globalThis.document.createElement("canvas")
      renderCanvas.width = Math.ceil(width * outputScale)
      renderCanvas.height = Math.ceil(height * outputScale)
      const renderContext = renderCanvas.getContext("2d")
      if (!renderContext) return
      renderContext.setTransform(1, 0, 0, 1, 0, 0)
      renderContext.clearRect(0, 0, renderCanvas.width, renderCanvas.height)

      const currentRenderTask = page.render({
        canvas: null,
        canvasContext: renderContext,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      })
      renderTask = currentRenderTask

      await currentRenderTask.promise.catch((error: unknown) => {
        if (!cancelled) throw error
      })
      if (cancelled) return

      canvas.width = renderCanvas.width
      canvas.height = renderCanvas.height
      const visibleContext = canvas.getContext("2d")
      if (visibleContext) {
        visibleContext.setTransform(1, 0, 0, 1, 0, 0)
        visibleContext.clearRect(0, 0, canvas.width, canvas.height)
        visibleContext.drawImage(renderCanvas, 0, 0)
      }
      textLayerDiv.innerHTML = ""

      textContentTimeout = window.setTimeout(() => {
        void (async () => {
          const textContent = await pdfPageTextContent(page)
          if (cancelled) return
          props.onTextItems(props.pageNumber, pdfTextItemsFromContent(textContent, viewport, props.pageNumber))
        })().catch((error) => {
          if (!cancelled) console.error("[PdfRenderer] text extraction failed:", error)
        })
      }, PDF_TEXT_EXTRACTION_DELAY_MS)
    })().catch((error) => {
      if (!cancelled) console.error("[PdfRenderer] page render failed:", error)
    })

    onCleanup(() => {
      cancelled = true
      if (textContentTimeout !== undefined) window.clearTimeout(textContentTimeout)
      renderTask?.cancel()
    })
  })

  createEffect(() => {
    const shouldRender = props.shouldRender
    const canvas = canvasRef
    const textLayerDiv = textLayerRef
    if (shouldRender || !canvas) return
    if (canvas.width > 1 || canvas.height > 1) {
      canvas.width = 1
      canvas.height = 1
    }
    if (textLayerDiv) textLayerDiv.innerHTML = ""
  })

  return (
    <div ref={pageRef} class="parvis-pdf-page relative bg-white shadow-sm" data-page-number={props.pageNumber}>
      <canvas class="block" ref={canvasRef} />
      <div ref={textLayerRef} class="textLayer" />
      <div class="parvis-pdf-selection-layer" aria-hidden="true">
        <For each={props.selectionRects ?? []}>
          {(rect) => (
            <div
              class="parvis-pdf-selection-rect"
              style={{
                left: `${rect.x}px`,
                top: `${rect.y}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
              }}
            />
          )}
        </For>
      </div>
    </div>
  )
}

function pdfTextItemsFromContent(textContent: any, viewport: any, pageNumber: number): PdfTextItem[] {
  const items = (textContent.items as any[])
    .map((item, index): PdfTextItem | undefined => {
      const text = typeof item.str === "string" ? item.str : ""
      if (!text.trim()) return
      const tx = pdfTransform(viewport.transform, item.transform)
      const fontHeight = Math.max(1, Math.hypot(tx[2] ?? 0, tx[3] ?? 0))
      const x = tx[4] ?? 0
      const y = (tx[5] ?? 0) - fontHeight
      const width = Math.max(1, Math.abs((item.width ?? 0) * viewport.scale))
      const height = Math.max(1, Math.abs((item.height ?? 0) * viewport.scale) || fontHeight)
      return {
        pageNumber,
        index,
        scale: viewport.scale,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
        text,
        x,
        y,
        width,
        height,
      }
    })
    .filter((item): item is PdfTextItem => !!item)
  return pdfSelectableTextItems(items)
}

function pdfTextGraphemes(text: string) {
  if (!text) return []
  if (pdfGraphemeSegmenter) return Array.from(pdfGraphemeSegmenter.segment(text), (segment) => segment.segment)
  return Array.from(text)
}

function pdfGraphemeWeight(grapheme: string) {
  if (!grapheme.trim()) return 0.45
  if (/[\u3000-\u303f\uff00-\uffef]/u.test(grapheme)) return 0.75
  if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(grapheme)) return 1
  if (/[.,;:!?'"()[\]{}，。；：！？、（）《》“”‘’]/u.test(grapheme)) return 0.55
  return 0.75
}

function pdfSelectableTextItems(items: PdfTextItem[]) {
  const selectableItems: PdfTextItem[] = []
  for (const item of items) {
    const graphemes = pdfTextGraphemes(item.text)
    if (graphemes.length <= 1 || item.width <= 1) {
      selectableItems.push(item)
      continue
    }

    const weights = graphemes.map(pdfGraphemeWeight)
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || graphemes.length
    let x = item.x
    graphemes.forEach((grapheme, charIndex) => {
      const isLast = charIndex === graphemes.length - 1
      const width = isLast ? Math.max(1, item.x + item.width - x) : Math.max(1, (item.width * weights[charIndex]!) / totalWeight)
      selectableItems.push({
        ...item,
        index: item.index * PDF_TEXT_ITEM_INDEX_MULTIPLIER + charIndex,
        text: grapheme,
        x,
        width,
      })
      x += width
    })
  }
  return selectableItems
}

async function pdfPageTextContent(page: any) {
  if (typeof page.streamTextContent !== "function") return page.getTextContent()

  const stream = page.streamTextContent()
  const reader = stream.getReader()
  const textContent = {
    items: [] as any[],
    styles: Object.create(null),
    lang: null as string | null,
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      textContent.lang ??= value?.lang ?? null
      Object.assign(textContent.styles, value?.styles ?? {})
      textContent.items.push(...(value?.items ?? []))
    }
  } finally {
    reader.releaseLock?.()
  }

  return textContent
}

function pdfTransform(a: number[], b: number[]) {
  return [
    a[0]! * b[0]! + a[2]! * b[1]!,
    a[1]! * b[0]! + a[3]! * b[1]!,
    a[0]! * b[2]! + a[2]! * b[3]!,
    a[1]! * b[2]! + a[3]! * b[3]!,
    a[0]! * b[4]! + a[2]! * b[5]! + a[4]!,
    a[1]! * b[4]! + a[3]! * b[5]! + a[5]!,
  ]
}

function normalizePdfSelectionRect(input: { startX: number; startY: number; currentX: number; currentY: number }) {
  const left = Math.min(input.startX, input.currentX)
  const top = Math.min(input.startY, input.currentY)
  const right = Math.max(input.startX, input.currentX)
  const bottom = Math.max(input.startY, input.currentY)
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

function pdfPointInPageRect(pageRect: DOMRect, clientX: number, clientY: number) {
  return {
    x: Math.min(Math.max(clientX - pageRect.left, 0), pageRect.width),
    y: Math.min(Math.max(clientY - pageRect.top, 0), pageRect.height),
  }
}

function pdfRectsIntersect(a: PdfSelectionRect, b: PdfSelectionRect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function pdfHitRect(rect: PdfSelectionRect) {
  const horizontalPadding = rect.width < 2 ? 4 : 0
  const verticalPadding = Math.max(8, rect.height < 12 ? 12 : 4)
  return {
    x: rect.x - horizontalPadding,
    y: rect.y - verticalPadding,
    width: rect.width + horizontalPadding * 2,
    height: rect.height + verticalPadding * 2,
  }
}

function pdfSelectionCandidateRects(
  items: PdfTextItem[],
  rect: PdfSelectionRect,
  pageSize?: { width: number; height: number },
) {
  const first = items[0]
  if (!first || !pageSize || pageSize.width <= 0 || pageSize.height <= 0) return [rect]
  const scaleX = first.pageWidth / pageSize.width
  const scaleY = first.pageHeight / pageSize.height
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return [rect]
  if (Math.abs(scaleX - 1) < 0.001 && Math.abs(scaleY - 1) < 0.001) return [rect]
  return [
    rect,
    {
      x: rect.x * scaleX,
      y: rect.y * scaleY,
      width: rect.width * scaleX,
      height: rect.height * scaleY,
    },
  ]
}

function pdfRowsFromItems(items: PdfTextItem[]) {
  const rows: PdfTextRow[] = []
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x || a.index - b.index)) {
    const centerY = item.y + item.height / 2
    const recentRows = rows.slice(Math.max(0, rows.length - PDF_ROW_LOOKBACK_COUNT))
    const row = recentRows.find((candidate) => {
      const candidateCenter = candidate.y + candidate.height / 2
      return Math.abs(centerY - candidateCenter) <= Math.max(candidate.height, item.height, 12) * 0.8
    })
    if (row) {
      row.items.push(item)
      const top = Math.min(row.y, item.y)
      const bottom = Math.max(row.y + row.height, item.y + item.height)
      row.y = top
      row.height = bottom - top
    } else {
      rows.push({ y: item.y, height: item.height, items: [item] })
    }
  }
  return rows.map((row) => ({ ...row, items: row.items.sort((a, b) => a.x - b.x || a.index - b.index) }))
}

function pdfRowsIntersectingHitRect(rows: PdfTextRow[] | undefined, hitRect: PdfSelectionRect) {
  if (!rows?.length) return []
  return rows.filter((row) => row.y < hitRect.y + hitRect.height && row.y + row.height > hitRect.y)
}

function pdfItemsNearHitRect(items: PdfTextItem[], hitRect: PdfSelectionRect, rows?: PdfTextRow[]) {
  const rowItems = pdfRowsIntersectingHitRect(rows, hitRect).flatMap((row) => row.items)
  return rowItems.length > 0 ? rowItems : items
}

function pdfRowFallbackItems(items: PdfTextItem[], rect: PdfSelectionRect, rows?: PdfTextRow[]) {
  const hitRect = pdfHitRect(rect)
  const indexedRows = rows?.length ? rows : pdfRowsFromItems(items)
  const rowsInRange = indexedRows.filter((row) => {
    const rowCenter = row.y + row.height / 2
    return rowCenter >= hitRect.y && rowCenter <= hitRect.y + hitRect.height
  })
  const selectedRows =
    rowsInRange.length > 0
      ? rowsInRange
      : (() => {
          const sortedHeights = indexedRows.map((row) => row.height).sort((a, b) => a - b)
          const medianHeight = sortedHeights[Math.floor(sortedHeights.length / 2)] ?? 24
          const rowCount = Math.min(
            indexedRows.length,
            Math.max(1, Math.ceil(hitRect.height / Math.max(12, medianHeight))),
          )
          return indexedRows
            .map((row) => ({
              row,
              distance: Math.abs(row.y + row.height / 2 - (hitRect.y + hitRect.height / 2)),
            }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, rowCount)
            .map((item) => item.row)
        })()

  return selectedRows
    .sort((a, b) => a.y - b.y)
    .flatMap((row) => {
      const intersectingItems = row.items.filter((item) => {
        const itemLeft = item.x
        const itemRight = item.x + item.width
        return itemLeft < hitRect.x + hitRect.width && itemRight > hitRect.x
      })
      return intersectingItems.length > 0 ? intersectingItems : []
    })
    .sort((a, b) => a.index - b.index)
}

function pdfSelectedItems(
  items: PdfTextItem[],
  rect: PdfSelectionRect,
  pageSize?: { width: number; height: number },
  rows?: PdfTextRow[],
) {
  if (rect.width < 2 && rect.height < 2) return []
  for (const candidateRect of pdfSelectionCandidateRects(items, rect, pageSize)) {
    const hitRect = pdfHitRect(candidateRect)
    const candidateItems = pdfItemsNearHitRect(items, hitRect, rows)
    const direct = candidateItems
      .filter((item) => pdfRectsIntersect(hitRect, item))
      .sort((a, b) => a.index - b.index)
    if (direct.length > 0) return direct

    const top = hitRect.y
    const bottom = hitRect.y + hitRect.height
    const left = hitRect.x
    const right = hitRect.x + hitRect.width
    const centerHits = candidateItems
      .filter((item) => {
        const centerY = item.y + item.height / 2
        const itemLeft = item.x
        const itemRight = item.x + item.width
        return centerY >= top && centerY <= bottom && itemLeft < right && itemRight > left
      })
      .sort((a, b) => a.index - b.index)
    if (centerHits.length > 0) return centerHits

    const rowHits = pdfRowFallbackItems(items, candidateRect, rows)
    if (rowHits.length > 0) return rowHits
  }
  return []
}

function pdfSelectionText(items: PdfTextItem[]) {
  if (items.length === 0) return ""
  const rows = pdfRowsFromItems(items)
  let result = ""
  let previousRow: PdfTextRow | undefined
  let previousText = ""
  for (const row of rows) {
    const rowText = pdfInlineText(row.items)
    if (!rowText) continue
    if (!previousRow) {
      result += rowText
      previousRow = row
      previousText = rowText
      continue
    }

    result += pdfRowJoiner(previousRow, row, previousText, rowText)
    result += rowText
    previousRow = row
    previousText = rowText
  }
  return result
}

function pdfInlineText(items: PdfTextItem[]) {
  let result = ""
  let previous: PdfTextItem | undefined
  for (const item of pdfItemsInVisualOrder(items)) {
    if (
      previous &&
      !/\s$/.test(result) &&
      !/^\s/.test(item.text) &&
      item.x > previous.x + previous.width + Math.max(2, item.height * 0.2)
    ) {
      result += " "
    }
    result += item.text
    previous = item
  }
  return result
}

function pdfNeedsSpaceBetweenRows(previousText: string, nextText: string) {
  if (!previousText || !nextText) return ""
  if (/\s$/.test(previousText) || /^\s/.test(nextText)) return ""
  if (/[\u3400-\u9fff\uf900-\ufaff]$/u.test(previousText) || /^[\u3400-\u9fff\uf900-\ufaff]/u.test(nextText)) {
    return ""
  }
  return " "
}

function pdfLooksLikeListStart(text: string) {
  return /^\s*(?:[（(]?\d{1,3}[）).、]|[a-zA-Z][）).、]|[一二三四五六七八九十]+[、.．])/.test(text)
}

function pdfRowJoiner(previousRow: PdfTextRow, nextRow: PdfTextRow, previousText: string, nextText: string) {
  const verticalStep = Math.abs(nextRow.y - previousRow.y)
  const lineHeight = Math.max(previousRow.height, nextRow.height, 12)
  const paragraphGap = verticalStep > lineHeight * 2.2
  const listBreak = /[。！？.!?]$/.test(previousText.trim()) && pdfLooksLikeListStart(nextText)
  if (paragraphGap || listBreak) return "\n"
  return pdfNeedsSpaceBetweenRows(previousText, nextText)
}

function pdfSameVisualRow(a: PdfTextItem, b: PdfTextItem) {
  const aCenter = a.y + a.height / 2
  const bCenter = b.y + b.height / 2
  return Math.abs(aCenter - bCenter) <= Math.max(a.height, b.height, 12) * 0.65
}

function pdfItemsInVisualOrder(items: PdfTextItem[]) {
  return [...items].sort((a, b) => {
    if (!pdfSameVisualRow(a, b)) return a.y - b.y || a.index - b.index
    return a.x - b.x || a.index - b.index
  })
}

function pdfSelectionRectsFromItems(items: PdfTextItem[]) {
  const rects: PdfSelectionRect[] = []
  for (const item of pdfItemsInVisualOrder(items)) {
    const previous = rects[rects.length - 1]
    if (previous) {
      const previousCenter = previous.y + previous.height / 2
      const itemCenter = item.y + item.height / 2
      const sameRow = Math.abs(previousCenter - itemCenter) <= Math.max(previous.height, item.height, 12) * 0.65
      const gap = item.x - (previous.x + previous.width)
      if (sameRow && gap <= Math.max(3, item.height * 0.35)) {
        const left = Math.min(previous.x, item.x)
        const top = Math.min(previous.y, item.y)
        const right = Math.max(previous.x + previous.width, item.x + item.width)
        const bottom = Math.max(previous.y + previous.height, item.y + item.height)
        previous.x = left
        previous.y = top
        previous.width = right - left
        previous.height = bottom - top
        continue
      }
    }

    rects.push({
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    })
  }
  return rects
}

function pdfNearestRowAtY(rows: PdfTextRow[], y: number) {
  let nearest: PdfTextRow | undefined
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const row of rows) {
    const center = row.y + row.height / 2
    const distance = Math.abs(y - center)
    if (distance < nearestDistance) {
      nearest = row
      nearestDistance = distance
    }
  }
  return nearest
}

function pdfCaretOffsetAtPoint(input: {
  orderedItems: PdfTextItem[]
  order: Map<PdfTextItem, number>
  rows: PdfTextRow[]
  x: number
  y: number
}) {
  const row = pdfNearestRowAtY(input.rows, input.y)
  if (!row) return
  const rowItems = [...row.items].sort((a, b) => a.x - b.x || a.index - b.index)
  const first = rowItems[0]
  const last = rowItems[rowItems.length - 1]
  if (!first || !last) return

  if (input.x <= first.x + first.width / 2) return input.order.get(first) ?? 0
  for (const item of rowItems) {
    const center = item.x + item.width / 2
    if (input.x < center) return input.order.get(item) ?? 0
  }
  return (input.order.get(last) ?? input.orderedItems.length - 1) + 1
}

function pdfSequentialSelectionItems(input: {
  textItems: PdfTextItem[]
  textRows: PdfTextRow[]
  startX: number
  startY: number
  currentX: number
  currentY: number
}) {
  if (input.textItems.length === 0) return []
  const orderedItems = pdfItemsInVisualOrder(input.textItems)
  const order = new Map<PdfTextItem, number>()
  orderedItems.forEach((item, index) => order.set(item, index))
  const rows = input.textRows.length > 0 ? input.textRows : pdfRowsFromItems(input.textItems)
  const start = pdfCaretOffsetAtPoint({
    orderedItems,
    order,
    rows,
    x: input.startX,
    y: input.startY,
  })
  const end = pdfCaretOffsetAtPoint({
    orderedItems,
    order,
    rows,
    x: input.currentX,
    y: input.currentY,
  })
  if (start === undefined || end === undefined || start === end) return []
  const from = Math.max(0, Math.min(start, end))
  const to = Math.min(orderedItems.length, Math.max(start, end))
  return orderedItems.slice(from, to)
}

function pdfDomTextItemsFromPage(pageElement: HTMLElement, pageNumber: number, scale: number) {
  const pageRect = pageElement.getBoundingClientRect()
  const itemsFromSpans = (spans: HTMLElement[]) =>
    spans
      .map((span, index): PdfTextItem | undefined => {
        if (span.getAttribute("role") === "img") return
        const text = span.textContent ?? ""
        if (!text.trim()) return
        const rect = span.getBoundingClientRect()
        if (rect.width <= 0 && rect.height <= 0) return
        return {
          pageNumber,
          index,
          scale,
          pageWidth: pageRect.width,
          pageHeight: pageRect.height,
          text,
          x: rect.left - pageRect.left,
          y: rect.top - pageRect.top,
          width: Math.max(1, rect.width),
          height: Math.max(1, rect.height),
        }
      })
      .filter((item): item is PdfTextItem => !!item)

  const textLayerItems = itemsFromSpans(Array.from(pageElement.querySelectorAll<HTMLElement>(".textLayer span")))
  if (textLayerItems.length > 0) return textLayerItems
  return itemsFromSpans(Array.from(pageElement.querySelectorAll<HTMLElement>(".parvis-pdf-native-text-layer span")))
}

const PdfRenderer: Component<{
  buffer: ArrayBuffer
  version?: string
  onSelectionChange?: (selection: PreviewTextSelection | undefined) => void
  onSelectionContextMenu?: (selection: PreviewTextSelection | undefined, menu: { x: number; y: number }) => boolean | void
}> = (props) => {
  let viewportRef: HTMLDivElement | undefined
  let lastSelection: PreviewTextSelection | undefined
  let lastSelectionAt = 0
  let suppressEmptySelectionUntil = 0
  let cleanupMouseSelection: VoidFunction | undefined
  let cleanupViewportMouseDown: VoidFunction | undefined
  const textItemsRequests = new Map<string, Promise<PdfTextItem[]>>()
  const [viewportElement, setViewportElement] = createSignal<HTMLDivElement>()
  const [document, setDocument] = createSignal<any>()
  const [pageNumbers, setPageNumbers] = createSignal<number[]>([])
  const [zoom, setZoom] = createSignal(1)
  const [error, setError] = createSignal<string>()
  const [loading, setLoading] = createSignal(true)
  const [renderedPages, setRenderedPages] = createSignal<Record<number, true>>({})
  const [textItemsByPage, setTextItemsByPage] = createSignal<Record<number, PdfTextItem[]>>({})
  const [textRowsByPage, setTextRowsByPage] = createSignal<Record<number, PdfTextRow[]>>({})
  const [selectionRectsByPage, setSelectionRectsByPage] = createSignal<Record<number, PdfSelectionRect[]>>({})

  const initialRenderedPages = (numPages: number) => {
    const pages: Record<number, true> = {}
    for (let page = 1; page <= Math.min(numPages, PDF_INITIAL_RENDER_PAGE_COUNT); page++) {
      pages[page] = true
    }
    return pages
  }
  const renderedPageWindow = (targetPageNumbers: Iterable<number>) => {
    const maxPage = pageNumbers().length
    const pages: Record<number, true> = {}
    const expandedPageNumbers = new Set<number>()
    for (const pageNumber of targetPageNumbers) {
      for (let offset = -PDF_RENDER_NEIGHBOR_PAGE_COUNT; offset <= PDF_RENDER_NEIGHBOR_PAGE_COUNT; offset++) {
        const targetPageNumber = pageNumber + offset
        if (targetPageNumber >= 1 && targetPageNumber <= maxPage) expandedPageNumbers.add(targetPageNumber)
      }
    }
    for (const pageNumber of expandedPageNumbers) pages[pageNumber] = true
    if (Object.keys(pages).length === 0) return initialRenderedPages(maxPage)
    return pages
  }
  const prunePdfPageRecord = <T,>(current: Record<number, T>, activePages: Record<number, true>) => {
    const next: Record<number, T> = {}
    for (const [pageNumber, value] of Object.entries(current)) {
      if (activePages[Number(pageNumber)]) next[Number(pageNumber)] = value
    }
    return next
  }
  const setActiveRenderedPages = (targetPageNumbers: Iterable<number>) => {
    const activePages = renderedPageWindow(targetPageNumbers)
    batch(() => {
      setRenderedPages(activePages)
      setTextItemsByPage((current) => prunePdfPageRecord(current, activePages))
      setTextRowsByPage((current) => prunePdfPageRecord(current, activePages))
      setSelectionRectsByPage((current) => prunePdfPageRecord(current, activePages))
    })
    for (const key of Array.from(textItemsRequests.keys())) {
      const pageNumber = Number(key.split(":")[0])
      if (!activePages[pageNumber]) textItemsRequests.delete(key)
    }
  }

  createEffect(() => {
    const buffer = props.buffer
    let cancelled = false
    let loadedDocument: { cleanup: () => Promise<unknown> } | undefined
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)), ...pdfjsDocumentOptions })

    setLoading(true)
    setError(undefined)
    setDocument(undefined)
    setPageNumbers([])
    setRenderedPages({})
    setTextItemsByPage({})
    setTextRowsByPage({})
    setSelectionRectsByPage({})
    textItemsRequests.clear()

    void loadingTask.promise
      .then((pdf) => {
        if (cancelled) return
        loadedDocument = pdf
        setDocument(pdf)
        setPageNumbers(Array.from({ length: pdf.numPages }, (_, index) => index + 1))
        setRenderedPages(initialRenderedPages(pdf.numPages))
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : "PDF 渲染失败")
        setLoading(false)
      })

    onCleanup(() => {
      cancelled = true
      void loadingTask.destroy()
      void loadedDocument?.cleanup()
    })
  })

  createEffect(() => {
    zoom()
    batch(() => {
      setTextItemsByPage({})
      setTextRowsByPage({})
      setSelectionRectsByPage({})
      textItemsRequests.clear()
    })
  })

  createEffect(() => {
    const viewport = viewportElement()
    const pages = pageNumbers()
    if (!viewport || pages.length === 0) return

    if (typeof IntersectionObserver === "undefined") {
      setActiveRenderedPages(pages)
      return
    }

    let cancelled = false
    let observer: IntersectionObserver | undefined
    const intersectingPages = new Set<number>()

    const frame = requestAnimationFrame(() => {
      if (cancelled) return
      const pageElements = Array.from(viewport.querySelectorAll<HTMLElement>(".parvis-pdf-page"))
      observer = new IntersectionObserver(
        (entries) => {
          let changed = false
          for (const entry of entries) {
            const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber)
            if (!Number.isFinite(pageNumber)) continue
            if (entry.isIntersecting) {
              if (!intersectingPages.has(pageNumber)) {
                intersectingPages.add(pageNumber)
                changed = true
              }
            } else if (intersectingPages.delete(pageNumber)) {
              changed = true
            }
          }
          if (changed) setActiveRenderedPages(intersectingPages)
        },
        {
          root: viewport,
          rootMargin: `${PDF_RENDER_OVERSCAN_PX}px 0px`,
          threshold: 0.01,
        },
      )
      for (const pageElement of pageElements) observer.observe(pageElement)
    })

    onCleanup(() => {
      cancelled = true
      cancelAnimationFrame(frame)
      observer?.disconnect()
    })
  })

  onCleanup(() => {
    cleanupMouseSelection?.()
    cleanupViewportMouseDown?.()
  })

  const setPdfTextItems = (pageNumber: number, items: PdfTextItem[]) => {
    batch(() => {
      setTextItemsByPage((current) => ({ ...current, [pageNumber]: items }))
      setTextRowsByPage((current) => ({ ...current, [pageNumber]: pdfRowsFromItems(items) }))
    })
  }
  const currentPdfTextItems = (pageNumber: number) => {
    const items = textItemsByPage()[pageNumber] ?? []
    const currentZoom = zoom()
    if (items.length > 0 && Math.abs((items[0]?.scale ?? currentZoom) - currentZoom) < 0.001) return items
    return []
  }
  const currentPdfTextRows = (pageNumber: number) => {
    const items = currentPdfTextItems(pageNumber)
    if (items.length === 0) return []
    return textRowsByPage()[pageNumber] ?? []
  }
  const ensurePdfTextItems = async (pageNumber: number) => {
    const existing = currentPdfTextItems(pageNumber)
    if (existing.length > 0) return existing

    const pdf = document()
    if (!pdf) return []
    const currentZoom = zoom()
    const key = `${pageNumber}:${currentZoom}`
    let request = textItemsRequests.get(key)
    if (!request) {
      request = (async () => {
        const page = await pdf.getPage(pageNumber)
        const viewport = page.getViewport({ scale: currentZoom })
        const textContent = await pdfPageTextContent(page)
        return pdfTextItemsFromContent(textContent, viewport, pageNumber)
      })()
      textItemsRequests.set(key, request)
    }

    try {
      const items = await request
      if (Math.abs(zoom() - currentZoom) < 0.001) {
        setPdfTextItems(pageNumber, items)
      }
      return items
    } catch (error) {
      console.error("[PdfRenderer] text extraction failed:", error)
      return []
    }
  }
  const currentPdfSelectedText = () => window.getSelection?.()?.toString?.() ?? ""
  const pdfSelection = (menu?: { x: number; y: number }) => {
    if (!viewportRef) return
    const selection = selectionSnapshotFromWindow(viewportRef, "")
    if (!selection || !menu) return selection
    return { ...selection, menu }
  }
  const emitSelection = () => {
    const selection = pdfSelection()
    if (selection) {
      lastSelection = selection
      lastSelectionAt = Date.now()
      props.onSelectionChange?.(selection)
      return
    }

    if (lastSelection && (currentPdfSelectedText().trim() || Date.now() < suppressEmptySelectionUntil)) return
    props.onSelectionChange?.(undefined)
  }
  const selectionForMenu = (menu: { x: number; y: number }) => {
    const selectedText = currentPdfSelectedText()
    const selection =
      pdfSelection(menu) ??
      selectionSnapshotFromTextAndPoint({
        selectedText,
        source: "",
        x: menu.x,
        y: menu.y,
      }) ??
      (lastSelection && Object.keys(selectionRectsByPage()).length > 0 ? { ...lastSelection, menu } : undefined) ??
      (lastSelection && Date.now() - lastSelectionAt < 2000 ? { ...lastSelection, menu } : undefined)
    if (selection) {
      lastSelection = selection
      lastSelectionAt = Date.now()
    }
    return selection
  }
  const emitContextMenu = (event: MouseEvent) => {
    const menu = { x: event.clientX, y: event.clientY }
    const selection = selectionForMenu(menu)
    if (!selection) return
    suppressEmptySelectionUntil = Date.now() + 800
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    props.onSelectionContextMenu?.(selection, menu)
  }
  const pdfPageElementFromPoint = (clientX: number, clientY: number) => {
    const viewport = viewportRef
    if (!viewport) return
    const pages = Array.from(viewport.querySelectorAll<HTMLElement>(".parvis-pdf-page"))
    return pages.find((page) => {
      const rect = page.getBoundingClientRect()
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
    })
  }
  const selectionFromPdfItems = (input: {
    pageNumber: number
    rect: PdfSelectionRect
    pageRect: DOMRect
    selectedItems?: PdfTextItem[]
    textItems?: PdfTextItem[]
    textRows?: PdfTextRow[]
  }): PreviewTextSelection | undefined => {
    const textItems = input.textItems ?? currentPdfTextItems(input.pageNumber)
    const textRows = input.textRows ?? currentPdfTextRows(input.pageNumber)
    const items =
      input.selectedItems ??
      pdfSelectedItems(
        textItems,
        input.rect,
        {
          width: input.pageRect.width,
          height: input.pageRect.height,
        },
        textRows,
      )
    const selectedText = pdfSelectionText(items)
    if (!selectedText.trim()) return
    return selectionSnapshotFromTextAndPoint({
      selectedText,
      source: "",
      x: input.pageRect.left + input.rect.x + input.rect.width / 2,
      y: input.pageRect.top + input.rect.y,
    })
  }
  const updatePdfDragSelection = (input: {
    pageNumber: number
    pageRect: DOMRect
    startX: number
    startY: number
    currentX: number
    currentY: number
    textItems?: PdfTextItem[]
    textRows?: PdfTextRow[]
  }) => {
    const dragRect = normalizePdfSelectionRect(input)
    const textItems = input.textItems ?? currentPdfTextItems(input.pageNumber)
    const textRows = input.textRows ?? currentPdfTextRows(input.pageNumber)
    const items = pdfSequentialSelectionItems({
      textItems,
      textRows,
      startX: input.startX,
      startY: input.startY,
      currentX: input.currentX,
      currentY: input.currentY,
    })
    setSelectionRectsByPage({
      [input.pageNumber]:
        items.length > 0
          ? pdfSelectionRectsFromItems(items)
          : dragRect.width > 2 || dragRect.height > 2
            ? [dragRect]
            : [],
    })
    return selectionFromPdfItems({
      pageNumber: input.pageNumber,
      rect: dragRect,
      pageRect: input.pageRect,
      selectedItems: items,
      textItems,
      textRows,
    })
  }
  const beginPdfMouseSelection = (event: MouseEvent) => {
    if (event.button !== 0) return
    if (cleanupMouseSelection) return
    const pageElement = pdfPageElementFromPoint(event.clientX, event.clientY)
    if (!(pageElement instanceof HTMLElement)) return
    const pageNumber = Number(pageElement.dataset.pageNumber)
    if (!Number.isFinite(pageNumber)) return

    const pageRect = pageElement.getBoundingClientRect()
    const startPoint = pdfPointInPageRect(pageRect, event.clientX, event.clientY)
    const startX = startPoint.x
    const startY = startPoint.y
    let latestSelection: PreviewTextSelection | undefined
    let moved = false
    let latestPoint = startPoint
    let moveFrame: number | undefined

    event.preventDefault()
    event.stopPropagation()
    globalThis.getSelection?.()?.removeAllRanges()
    setSelectionRectsByPage({})
    void ensurePdfTextItems(pageNumber)

    const flushMove = () => {
      moveFrame = undefined
      const textItems = currentPdfTextItems(pageNumber)
      const textRows = currentPdfTextRows(pageNumber)
      latestSelection = updatePdfDragSelection({
        pageNumber,
        pageRect,
        startX,
        startY,
        currentX: latestPoint.x,
        currentY: latestPoint.y,
        textItems: textItems.length > 0 ? textItems : undefined,
        textRows,
      })
    }
    const move = (moveEvent: MouseEvent) => {
      const point = pdfPointInPageRect(pageRect, moveEvent.clientX, moveEvent.clientY)
      latestPoint = point
      moved = moved || Math.abs(point.x - startX) > 2 || Math.abs(point.y - startY) > 2
      if (moveFrame === undefined) moveFrame = requestAnimationFrame(flushMove)
    }
    const finish = (upEvent: MouseEvent) => {
      cleanupMouseSelection?.()
      cleanupMouseSelection = undefined
      if (moveFrame !== undefined) {
        cancelAnimationFrame(moveFrame)
        moveFrame = undefined
      }
      const point = pdfPointInPageRect(pageRect, upEvent.clientX, upEvent.clientY)
      const finalRect = normalizePdfSelectionRect({
        startX,
        startY,
        currentX: point.x,
        currentY: point.y,
      })

      const commitSelection = async () => {
        const domTextItems = pdfDomTextItemsFromPage(pageElement, pageNumber, zoom())
        const domTextRows = domTextItems.length > 0 ? pdfRowsFromItems(domTextItems) : []
        const pageSize = {
          width: pageRect.width,
          height: pageRect.height,
        }
        const domHits = pdfSelectedItems(domTextItems, finalRect, pageSize, domTextRows)
        const textItems = domHits.length > 0 ? domTextItems : await ensurePdfTextItems(pageNumber)
        const textRows = domHits.length > 0 ? domTextRows : currentPdfTextRows(pageNumber)
        latestSelection = updatePdfDragSelection({
          pageNumber,
          pageRect,
          startX,
          startY,
          currentX: point.x,
          currentY: point.y,
          textItems,
          textRows,
        })
        if (!latestSelection || (!moved && finalRect.width < 2 && finalRect.height < 2)) {
          setSelectionRectsByPage({})
          props.onSelectionChange?.(undefined)
          return
        }
        lastSelection = latestSelection
        lastSelectionAt = Date.now()
        props.onSelectionChange?.(latestSelection)
      }
      void commitSelection()
    }
    cleanupMouseSelection = () => {
      if (moveFrame !== undefined) {
        cancelAnimationFrame(moveFrame)
        moveFrame = undefined
      }
      globalThis.document.removeEventListener("mousemove", move)
      globalThis.document.removeEventListener("mouseup", finish)
    }
    globalThis.document.addEventListener("mousemove", move)
    globalThis.document.addEventListener("mouseup", finish)
  }
  const setPdfViewport = (el: HTMLDivElement) => {
    cleanupViewportMouseDown?.()
    viewportRef = el
    setViewportElement(el)
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return
      beginPdfMouseSelection(event)
    }
    el.addEventListener("mousedown", onMouseDown, true)
    cleanupViewportMouseDown = () => {
      el.removeEventListener("mousedown", onMouseDown, true)
    }
  }

  return (
    <PreviewShell
      bottomControls={
        <PreviewZoomControls
          zoom={zoom()}
          min={0.5}
          max={2}
          onZoomOut={() => setZoom((value) => Math.max(0.5, Math.round((value - 0.1) * 10) / 10))}
          onZoomIn={() => setZoom((value) => Math.min(2, Math.round((value + 0.1) * 10) / 10))}
          onZoomChange={(value) => setZoom(Math.min(2, Math.max(0.5, value)))}
          onFitWidth={() => setZoom(1)}
        />
      }
      viewportRef={setPdfViewport}
      viewportClass="bg-slate-100 p-4"
    >
      <style>{`
        .parvis-pdf-page {
          margin: 0 auto 16px auto;
          width: max-content;
          max-width: none;
          -webkit-user-select: text;
          user-select: text;
          cursor: text;
        }
        .parvis-pdf-page-stack {
          position: relative;
          min-height: 100%;
        }
        .parvis-pdf-event-layer {
          position: absolute;
          inset: 0;
          z-index: 5;
          cursor: text;
          background: transparent;
        }
        .parvis-pdf-page canvas {
          pointer-events: none;
        }
        .parvis-pdf-page .textLayer {
          position: absolute;
          inset: 0;
          z-index: 2;
          overflow: hidden;
          line-height: 1;
          opacity: 1;
          pointer-events: auto;
          transform-origin: 0 0;
          --min-font-size: 1;
          --min-font-size-inv: calc(1 / var(--min-font-size));
          --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
          -webkit-user-select: text;
          user-select: text;
        }
        .parvis-pdf-page .textLayer span,
        .parvis-pdf-page .textLayer br {
          color: transparent;
          position: absolute;
          white-space: pre;
          cursor: text;
          transform-origin: 0% 0%;
          -webkit-user-select: text;
          user-select: text;
        }
        .parvis-pdf-page .textLayer > :not(.markedContent),
        .parvis-pdf-page .textLayer .markedContent span:not(.markedContent) {
          z-index: 1;
          --font-height: 0;
          font-size: calc(var(--text-scale-factor) * var(--font-height));
          --scale-x: 1;
          --rotate: 0deg;
          transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
        }
        .parvis-pdf-page .textLayer .markedContent {
          display: contents;
        }
        .parvis-pdf-page .textLayer span[role="img"] {
          -webkit-user-select: none;
          user-select: none;
          cursor: default;
        }
        .parvis-pdf-page .textLayer ::selection {
          background: rgba(0, 0, 255, 0.25);
          color: transparent;
        }
        .parvis-pdf-page .textLayer br::selection {
          background: transparent;
        }
        .parvis-pdf-page .parvis-pdf-native-text-layer {
          position: absolute;
          inset: 0;
          z-index: 3;
          pointer-events: auto;
          -webkit-user-select: text;
          user-select: text;
        }
        .parvis-pdf-page .parvis-pdf-native-text-layer span {
          position: absolute;
          display: block;
          overflow: hidden;
          white-space: pre;
          cursor: text;
          color: rgba(0, 0, 0, 0.01);
          font-family: sans-serif;
          -webkit-user-select: text;
          user-select: text;
        }
        .parvis-pdf-page .parvis-pdf-native-text-layer span::selection {
          background: rgba(0, 100, 255, 0.25);
          color: transparent;
        }
        .parvis-pdf-page .parvis-pdf-selection-layer {
          position: absolute;
          inset: 0;
          z-index: 4;
          pointer-events: none;
        }
        .parvis-pdf-page .parvis-pdf-selection-rect {
          position: absolute;
          background: rgba(0, 100, 255, 0.22);
          border-radius: 2px;
        }
      `}</style>
      <Show when={loading()}>
        <div class="px-6 py-4 text-text-weak">正在加载 PDF...</div>
      </Show>
      <Show when={error()}>
        {(message) => <div class="px-6 py-4 text-text-weak">PDF 渲染失败：{message()}</div>}
      </Show>
      <Show when={!loading() && !error()}>
        <div
          data-parvis-preview-selection-scope="true"
          class="parvis-pdf-page-stack min-h-full select-text"
          onKeyUp={emitSelection}
          onContextMenu={emitContextMenu}
        >
          <For each={pageNumbers()}>
            {(pageNumber) => (
              <PdfPageRenderer
                document={document}
                pageNumber={pageNumber}
                zoom={zoom()}
                shouldRender={renderedPages()[pageNumber] === true}
                textItems={textItemsByPage()[pageNumber]}
                selectionRects={selectionRectsByPage()[pageNumber]}
                onTextItems={setPdfTextItems}
              />
            )}
          </For>
          <div
            class="parvis-pdf-event-layer"
            aria-hidden="true"
            onMouseDown={beginPdfMouseSelection}
            onContextMenu={emitContextMenu}
          />
        </div>
      </Show>
    </PreviewShell>
  )
}

export const OfficePreview: Component<{
  content: FileContent
  path: string
  version?: string
  onSelectionChange?: (selection: PreviewTextSelection | undefined) => void
  onSelectionContextMenu?: (selection: PreviewTextSelection | undefined, menu: { x: number; y: number }) => boolean | void
}> = (props) => {
  const buffer = createMemo(() => {
    const b64 = props.content.content
    if (!b64) return null
    try {
      return base64ToArrayBuffer(b64)
    } catch {
      return null
    }
  })
  const [docxSource, setDocxSource] = createSignal("")

  createEffect(() => {
    const isDocx = !!props.content.mimeType?.includes("wordprocessingml")
    const b64 = isDocx ? props.content.content : ""
    let cancelled = false

    if (!b64) {
      setDocxSource("")
      return
    }

    setDocxSource("")
    void docxPlainTextFromBase64(b64)
      .then((text) => {
        if (!cancelled) setDocxSource(text)
      })
      .catch(() => {
        if (!cancelled) setDocxSource("")
      })

    onCleanup(() => {
      cancelled = true
    })
  })

  return (
    <Show when={buffer()} fallback={<div class="px-6 py-4 text-text-weak">Failed to decode file content</div>}>
      {(buf) => (
        <Switch>
          <Match when={props.content.mimeType?.includes("wordprocessingml")}>
            <DocxRenderer
              buffer={buf()}
              source={docxSource()}
              onSelectionChange={props.onSelectionChange}
              onSelectionContextMenu={props.onSelectionContextMenu}
            />
          </Match>
          <Match
            when={
              props.content.mimeType?.includes("spreadsheetml") || props.content.mimeType === "application/vnd.ms-excel"
            }
          >
            <XlsxRenderer buffer={buf()} path={props.path} />
          </Match>
          <Match when={props.content.mimeType?.includes("presentationml")}>
            <PptxRenderer buffer={buf()} path={props.path} />
          </Match>
          <Match when={props.content.mimeType === "application/pdf"}>
            <PdfRenderer
              buffer={buf()}
              version={props.version}
              onSelectionChange={props.onSelectionChange}
              onSelectionContextMenu={props.onSelectionContextMenu}
            />
          </Match>
        </Switch>
      )}
    </Show>
  )
}
