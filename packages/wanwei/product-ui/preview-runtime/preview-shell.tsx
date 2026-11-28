/* oxlint-disable -- Parvis source retained with its original control flow and types; see preview-runtime/LICENSE. */
import { IconButton } from "@opencode-ai/ui/icon-button"
import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from "solid-js"

export function previewFilename(path: string) {
  return path.split("/").pop() || path
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export type PreviewShellProps = {
  children: JSX.Element
  bottomControls?: JSX.Element
  viewportFooter?: JSX.Element
  viewportClass?: string
  viewportStyle?: JSX.CSSProperties
  viewportRef?: (el: HTMLDivElement) => void
  onViewportScroll?: JSX.EventHandlerUnion<HTMLDivElement, Event>
  onViewportPointerDown?: JSX.EventHandlerUnion<HTMLDivElement, PointerEvent>
  onViewportPointerMove?: JSX.EventHandlerUnion<HTMLDivElement, PointerEvent>
  onViewportPointerUp?: JSX.EventHandlerUnion<HTMLDivElement, PointerEvent>
  onViewportPointerCancel?: JSX.EventHandlerUnion<HTMLDivElement, PointerEvent>
  onViewportLostPointerCapture?: JSX.EventHandlerUnion<HTMLDivElement, PointerEvent>
}

export function PreviewShell(props: PreviewShellProps) {
  return (
    <div class="flex h-full min-h-0 min-w-0 flex-col bg-background-stronger text-text-default">
      <div
        ref={props.viewportRef}
        class={`min-h-0 min-w-0 flex-1 overflow-auto ${props.viewportClass ?? ""}`}
        style={props.viewportStyle}
        data-scrollable
        onScroll={props.onViewportScroll}
        onPointerDown={props.onViewportPointerDown}
        onPointerMove={props.onViewportPointerMove}
        onPointerUp={props.onViewportPointerUp}
        onPointerCancel={props.onViewportPointerCancel}
        onLostPointerCapture={props.onViewportLostPointerCapture}
      >
        {props.children}
      </div>

      <Show when={props.viewportFooter}>
        <div class="shrink-0">{props.viewportFooter}</div>
      </Show>

      <Show when={props.bottomControls}>
        <div
          data-slot="preview-bottom-toolbar"
          class="flex h-6 min-w-0 shrink-0 items-center justify-center border-t border-border-base bg-surface-weak px-3"
        >
          <div class="flex min-w-0 items-center gap-2">{props.bottomControls}</div>
        </div>
      </Show>
    </div>
  )
}

export type PreviewZoomControlsProps = {
  zoom: number
  min: number
  max: number
  onZoomOut: () => void
  onZoomIn: () => void
  onZoomChange: (zoom: number) => void
  onFitWidth: () => void
}

export function PreviewZoomControls(props: PreviewZoomControlsProps) {
  return (
    <div class="flex min-w-0 items-center gap-1 text-text-weak">
      <style>
        {`
          .parvis-preview-zoom-slider {
            appearance: none;
            height: 24px;
            background: transparent;
            cursor: pointer;
          }
          .parvis-preview-zoom-slider::-webkit-slider-runnable-track {
            height: 4px;
            border-radius: 999px;
            background: var(--surface-inset-strong);
          }
          .parvis-preview-zoom-slider::-webkit-slider-thumb {
            appearance: none;
            width: 18px;
            height: 18px;
            margin-top: -7px;
            border: 1px solid var(--border-base);
            border-radius: 999px;
            background: var(--surface-raised-stronger-non-alpha);
            box-shadow: var(--shadow-sm);
          }
          .parvis-preview-zoom-slider::-moz-range-track {
            height: 4px;
            border: 0;
            border-radius: 999px;
            background: var(--surface-inset-strong);
          }
          .parvis-preview-zoom-slider::-moz-range-thumb {
            width: 18px;
            height: 18px;
            border: 1px solid var(--border-base);
            border-radius: 999px;
            background: var(--surface-raised-stronger-non-alpha);
            box-shadow: var(--shadow-sm);
          }
          .parvis-preview-zoom-slider:focus-visible {
            outline: 2px solid var(--border-strong-base);
            outline-offset: 2px;
            border-radius: 999px;
          }
        `}
      </style>
      <IconButton
        icon="fit-width"
        variant="ghost"
        onClick={props.onFitWidth}
        title="适宽"
        aria-label="适宽"
      />
      <div class="mx-1 h-5 w-px shrink-0 bg-border-base" />
      <IconButton
        icon="dash"
        variant="ghost"
        disabled={props.zoom <= props.min + 0.001}
        onClick={props.onZoomOut}
        title="缩小"
        aria-label="缩小"
      />
      <input
        type="range"
        min={props.min}
        max={props.max}
        step="0.01"
        value={props.zoom}
        class="parvis-preview-zoom-slider w-[clamp(72px,12vw,156px)] min-w-0"
        onInput={(event) => props.onZoomChange(Number(event.currentTarget.value))}
        title={`缩放 ${Math.round(props.zoom * 100)}%`}
        aria-label="缩放比例"
        aria-valuetext={`${Math.round(props.zoom * 100)}%`}
      />
      <IconButton
        icon="plus-small"
        variant="ghost"
        disabled={props.zoom >= props.max - 0.001}
        onClick={props.onZoomIn}
        title="放大"
        aria-label="放大"
      />
      <output class="w-12 shrink-0 text-right text-sm-regular tabular-nums text-text-default">
        {Math.round(props.zoom * 100)}%
      </output>
    </div>
  )
}

export type PreviewHorizontalScrollControlsProps = {
  value: number
  max: number
  viewportSize?: number
  contentSize?: number
  ariaLabel?: string
  onInput: (value: number) => void
  onStepLeft: () => void
  onStepRight: () => void
  class?: string
}

export function PreviewHorizontalScrollControls(props: PreviewHorizontalScrollControlsProps) {
  let trackRef: HTMLDivElement | undefined
  let activePointerId: number | undefined
  let thumbGrabOffset = 0
  const [trackWidth, setTrackWidth] = createSignal(0)
  const [dragging, setDragging] = createSignal(false)

  const max = () => Math.max(0, props.max)
  const value = () => clamp(props.value, 0, max())
  const disabled = () => max() <= 0
  const viewportSize = () => Math.max(0, props.viewportSize ?? 0)
  const contentSize = () => {
    const provided = props.contentSize ?? 0
    if (provided > 0) return provided
    const viewport = viewportSize()
    return viewport > 0 ? viewport + max() : 0
  }
  const thumbWidth = createMemo(() => {
    const width = trackWidth()
    if (width <= 0) return 0
    if (disabled()) return width
    const content = contentSize()
    const viewport = viewportSize()
    const ratio = content > 0 && viewport > 0 ? viewport / content : 0.18
    return clamp(width * ratio, Math.min(56, width), width)
  })
  const thumbLeft = createMemo(() => {
    const travel = Math.max(0, trackWidth() - thumbWidth())
    return max() > 0 ? travel * (value() / max()) : 0
  })

  createEffect(() => {
    const track = trackRef
    if (!track) return
    const update = () => setTrackWidth(track.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(track)
    onCleanup(() => observer.disconnect())
  })

  const inputFromPointer = (clientX: number) => {
    const track = trackRef
    if (!track) return
    const rect = track.getBoundingClientRect()
    const travel = Math.max(1, trackWidth() - thumbWidth())
    const left = clamp(clientX - rect.left - thumbGrabOffset, 0, travel)
    props.onInput(clamp((left / travel) * max(), 0, max()))
  }

  const beginDrag = (event: PointerEvent, grabOffset: number, jumpToPointer: boolean) => {
    if (disabled() || event.button !== 0) return
    event.preventDefault()
    activePointerId = event.pointerId
    thumbGrabOffset = grabOffset
    setDragging(true)
    trackRef?.setPointerCapture(event.pointerId)
    if (jumpToPointer) inputFromPointer(event.clientX)
  }

  const endDrag = (event: PointerEvent) => {
    if (activePointerId !== event.pointerId) return
    activePointerId = undefined
    setDragging(false)
    if (trackRef?.hasPointerCapture(event.pointerId)) trackRef.releasePointerCapture(event.pointerId)
  }

  const keyStep = () => Math.max(24, max() / 20)

  return (
    <div class={`parvis-horizontal-scroll-controls flex min-w-0 items-center gap-1.5 ${props.class ?? ""}`}>
      <style>
        {`
          .parvis-horizontal-scroll-track {
            touch-action: none;
          }
          .parvis-horizontal-scroll-rail {
            background: var(--surface-base-active);
            box-shadow: inset 0 0 0 1px var(--border-weak-base);
          }
          .parvis-horizontal-scroll-thumb {
            background: var(--surface-raised-stronger-non-alpha);
            border: 1px solid var(--border-base);
            box-shadow: var(--shadow-xs);
          }
          .parvis-horizontal-scroll-track:hover .parvis-horizontal-scroll-rail,
          .parvis-horizontal-scroll-track:focus-visible .parvis-horizontal-scroll-rail,
          .parvis-horizontal-scroll-track[data-dragging="true"] .parvis-horizontal-scroll-rail {
            background: var(--surface-base-hover);
          }
          .parvis-horizontal-scroll-track:hover .parvis-horizontal-scroll-thumb,
          .parvis-horizontal-scroll-track:focus-visible .parvis-horizontal-scroll-thumb,
          .parvis-horizontal-scroll-track[data-dragging="true"] .parvis-horizontal-scroll-thumb {
            border-color: var(--border-strong-base);
            box-shadow: var(--shadow-md);
          }
          .parvis-horizontal-scroll-track[data-disabled="true"] {
            cursor: default;
            opacity: 0.42;
          }
        `}
      </style>
      <IconButton
        variant="ghost"
        icon="arrow-left"
        disabled={disabled() || value() <= 0}
        onClick={props.onStepLeft}
        title="左移"
        aria-label="左移"
      />
      <div
        ref={(el) => (trackRef = el)}
        role="slider"
        tabIndex={disabled() ? -1 : 0}
        aria-label={props.ariaLabel ?? "横向浏览位置"}
        aria-valuemin={0}
        aria-valuemax={Math.ceil(max())}
        aria-valuenow={Math.round(value())}
        data-disabled={disabled() ? "true" : "false"}
        data-dragging={dragging() ? "true" : "false"}
        class="parvis-horizontal-scroll-track relative h-6 min-w-16 flex-1 cursor-pointer outline-none"
        onPointerDown={(event) => beginDrag(event, thumbWidth() / 2, true)}
        onPointerMove={(event) => {
          if (activePointerId === event.pointerId) inputFromPointer(event.clientX)
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(event) => {
          if (disabled()) return
          if (event.key === "ArrowLeft") {
            event.preventDefault()
            props.onInput(clamp(value() - keyStep(), 0, max()))
          } else if (event.key === "ArrowRight") {
            event.preventDefault()
            props.onInput(clamp(value() + keyStep(), 0, max()))
          } else if (event.key === "PageUp" || event.key === "PageLeft") {
            event.preventDefault()
            props.onStepLeft()
          } else if (event.key === "PageDown" || event.key === "PageRight") {
            event.preventDefault()
            props.onStepRight()
          } else if (event.key === "Home") {
            event.preventDefault()
            props.onInput(0)
          } else if (event.key === "End") {
            event.preventDefault()
            props.onInput(max())
          }
        }}
      >
        <div class="parvis-horizontal-scroll-rail pointer-events-none absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full" />
        <div
          class="parvis-horizontal-scroll-thumb absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full"
          style={{
            left: `${thumbLeft()}px`,
            width: `${thumbWidth()}px`,
          }}
          onPointerDown={(event) => {
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            beginDrag(event, event.clientX - rect.left, false)
          }}
        />
      </div>
      <IconButton
        variant="ghost"
        icon="arrow-right"
        disabled={disabled() || value() >= max()}
        onClick={props.onStepRight}
        title="右移"
        aria-label="右移"
      />
    </div>
  )
}
