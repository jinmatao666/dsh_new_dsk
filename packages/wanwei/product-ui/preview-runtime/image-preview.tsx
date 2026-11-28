/* oxlint-disable -- Parvis source retained with its original control flow and types; see preview-runtime/LICENSE. */
import { createEffect, createMemo, createSignal, on, onCleanup, Show, type Component } from "solid-js"
import { PreviewShell, PreviewZoomControls } from "@/components/session/preview-shell"

type ImagePreviewProps = {
  src: string
  path: string
  onImageLoad?: () => void
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 4
const ZOOM_STEP = 0.25
const VIEWPORT_PADDING = 16
const PREVIEW_FRAME_PADDING = 12
const PREVIEW_FRAME_BORDER = 1
const PREVIEW_CHROME_SIZE = (VIEWPORT_PADDING + PREVIEW_FRAME_PADDING + PREVIEW_FRAME_BORDER) * 2

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

export const ImagePreview: Component<ImagePreviewProps> = (props) => {
  let previewViewport: HTMLDivElement | undefined
  let resizeObserver: ResizeObserver | undefined
  let centerFrame: number | undefined
  let panPointerId: number | undefined
  let panStartX = 0
  let panStartY = 0
  let panStartScrollLeft = 0
  let panStartScrollTop = 0

  const [imageSize, setImageSize] = createSignal<{ width: number; height: number }>()
  const [panning, setPanning] = createSignal(false)
  const [zoom, setZoom] = createSignal(1)
  const [autoFit, setAutoFit] = createSignal(true)
  const [viewportSize, setViewportSize] = createSignal({ width: 0, height: 0 })

  const previewSize = createMemo(() => imageSize() ?? { width: 800, height: 600 })
  const scaledSize = createMemo(() => ({
    width: previewSize().width * zoom(),
    height: previewSize().height * zoom(),
  }))
  const stageSize = createMemo(() => ({
    width: Math.max(scaledSize().width, viewportSize().width - PREVIEW_CHROME_SIZE),
    height: Math.max(scaledSize().height, viewportSize().height - PREVIEW_CHROME_SIZE),
  }))
  const canPanPreview = createMemo(
    () =>
      scaledSize().width > viewportSize().width - PREVIEW_CHROME_SIZE ||
      scaledSize().height > viewportSize().height - PREVIEW_CHROME_SIZE,
  )

  const updateViewportSize = () => {
    const viewport = previewViewport
    if (!viewport) return
    setViewportSize({
      width: viewport.clientWidth,
      height: viewport.clientHeight,
    })
  }

  const centerPreview = () => {
    if (centerFrame !== undefined) cancelAnimationFrame(centerFrame)
    centerFrame = requestAnimationFrame(() => {
      centerFrame = undefined
      const viewport = previewViewport
      if (!viewport) return
      viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2)
      viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2)
    })
  }

  const fitToWidth = () => {
    const viewport = previewViewport
    if (!viewport) return
    const size = previewSize()
    if (!size.width) return
    const available = Math.max(240, viewport.clientWidth - PREVIEW_CHROME_SIZE)
    setZoom(clampZoom(available / size.width))
    centerPreview()
  }

  const zoomBy = (delta: number) => {
    setAutoFit(false)
    setZoom((value) => clampZoom(Number((value + delta).toFixed(2))))
    centerPreview()
  }

  const setZoomFromToolbar = (value: number) => {
    setAutoFit(false)
    setZoom(clampZoom(value))
    centerPreview()
  }

  const handleFitToWidth = () => {
    setAutoFit(true)
    fitToWidth()
  }

  const stopPanning = (event?: PointerEvent) => {
    if (event && panPointerId !== event.pointerId) return
    const viewport = previewViewport
    if (viewport && panPointerId !== undefined) {
      try {
        viewport.releasePointerCapture(panPointerId)
      } catch {
        // Pointer capture may already be released by the browser.
      }
    }
    panPointerId = undefined
    setPanning(false)
  }

  const handlePreviewPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return
    const viewport = previewViewport
    if (!viewport) return
    if (!canPanPreview()) return

    panPointerId = event.pointerId
    panStartX = event.clientX
    panStartY = event.clientY
    panStartScrollLeft = viewport.scrollLeft
    panStartScrollTop = viewport.scrollTop
    setPanning(true)
    setAutoFit(false)
    viewport.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const handlePreviewPointerMove = (event: PointerEvent) => {
    if (panPointerId !== event.pointerId) return
    const viewport = previewViewport
    if (!viewport) return
    viewport.scrollLeft = panStartScrollLeft - (event.clientX - panStartX)
    viewport.scrollTop = panStartScrollTop - (event.clientY - panStartY)
    event.preventDefault()
  }

  const setPreviewViewport = (el: HTMLDivElement) => {
    previewViewport = el
    resizeObserver?.disconnect()
    resizeObserver = new ResizeObserver(() => {
      updateViewportSize()
      if (!autoFit()) return
      fitToWidth()
    })
    resizeObserver.observe(el)
    updateViewportSize()
    if (autoFit()) requestAnimationFrame(fitToWidth)
    else centerPreview()
  }

  createEffect(
    on(
      () => props.src,
      () => {
        setImageSize(undefined)
        setAutoFit(true)
      },
    ),
  )

  createEffect(() => {
    imageSize()
    if (!autoFit()) return
    requestAnimationFrame(fitToWidth)
  })

  onCleanup(() => {
    if (centerFrame !== undefined) cancelAnimationFrame(centerFrame)
    stopPanning()
    resizeObserver?.disconnect()
  })

  const handleImageLoad = (event: Event & { currentTarget: HTMLImageElement }) => {
    const image = event.currentTarget
    setImageSize({
      width: image.naturalWidth || image.width || 800,
      height: image.naturalHeight || image.height || 600,
    })
    props.onImageLoad?.()
  }

  return (
    <PreviewShell
      bottomControls={
        <PreviewZoomControls
          zoom={zoom()}
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          onZoomOut={() => zoomBy(-ZOOM_STEP)}
          onZoomIn={() => zoomBy(ZOOM_STEP)}
          onZoomChange={setZoomFromToolbar}
          onFitWidth={handleFitToWidth}
        />
      }
      viewportRef={setPreviewViewport}
      viewportClass="p-4 select-none"
      viewportStyle={{
        cursor: panning() ? "grabbing" : canPanPreview() ? "grab" : "default",
        "touch-action": canPanPreview() ? "none" : "auto",
      }}
      onViewportPointerDown={handlePreviewPointerDown}
      onViewportPointerMove={handlePreviewPointerMove}
      onViewportPointerUp={stopPanning}
      onViewportPointerCancel={stopPanning}
      onViewportLostPointerCapture={stopPanning}
    >
      <div
        class="rounded-md border border-border-weak-base bg-surface-base p-3"
        style={{
          width: `${stageSize().width}px`,
          height: `${stageSize().height}px`,
          "box-sizing": "content-box",
        }}
      >
        <div
          class="flex items-center justify-center"
          style={{
            width: `${stageSize().width}px`,
            height: `${stageSize().height}px`,
          }}
        >
          <Show
            when={props.src}
            fallback={
              <div class="h-full min-h-80 flex items-center justify-center text-sm-regular text-text-weak">
                正在加载图片预览...
              </div>
            }
          >
            <img
              src={props.src}
              alt={props.path}
              draggable={false}
              class="block max-w-none shrink-0"
              style={{
                width: `${scaledSize().width}px`,
                height: `${scaledSize().height}px`,
              }}
              onLoad={handleImageLoad}
            />
          </Show>
        </div>
      </div>
    </PreviewShell>
  )
}
