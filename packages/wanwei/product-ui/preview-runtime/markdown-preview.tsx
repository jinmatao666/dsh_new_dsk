/* oxlint-disable -- Parvis source retained with its original control flow and types; see preview-runtime/LICENSE. */
import { Component, createEffect, onCleanup } from "solid-js"
import { Markdown } from "@opencode-ai/ui/markdown"
import {
  selectionSnapshotFromDragText,
  selectionSnapshotFromPoints,
  selectionSnapshotFromTextAndPoint,
  selectionSnapshotFromWindow,
  type PreviewTextSelection,
} from "@/utils/preview-edit"
import "./markdown-preview.css"

export const MarkdownPreview: Component<{
  content: string
  onSelectionChange?: (selection: PreviewTextSelection | undefined) => void
  onSelectionContextMenu?: (
    selection: PreviewTextSelection | undefined,
    menu: { x: number; y: number },
  ) => boolean | void
}> = (props) => {
  let previewRef: HTMLDivElement | undefined
  let selecting = false
  let selectionChangeTimer: number | undefined
  let lastPoint: { x: number; y: number } | undefined
  let dragStartPoint: { x: number; y: number } | undefined

  const nodeBelongsToPreview = (node: Node | null) => {
    if (!previewRef || !node) return false
    let current: Node | null = node
    while (current) {
      if (current === previewRef) return true
      current = current.parentNode
    }
    return false
  }

  const selectionBelongsToPreview = () => {
    const selection = window.getSelection?.()
    if (!selection || selection.isCollapsed) return false
    return nodeBelongsToPreview(selection.anchorNode) && nodeBelongsToPreview(selection.focusNode)
  }

  const selectionFromDragPoints = (endPoint: { x: number; y: number }) => {
    if (!previewRef || !dragStartPoint) return
    try {
      return (
        selectionSnapshotFromPoints(previewRef, props.content, dragStartPoint, endPoint) ??
        selectionSnapshotFromDragText(previewRef, props.content, dragStartPoint, endPoint)
      )
    } catch {
      return selectionSnapshotFromDragText(previewRef, props.content, dragStartPoint, endPoint)
    }
  }

  const currentSelection = (menu?: { x: number; y: number }, forceMenuPoint = false) => {
    if (!previewRef) return
    let selection: PreviewTextSelection | undefined
    try {
      selection = selectionSnapshotFromWindow(previewRef, props.content)
    } catch {
      selection = undefined
    }
    if (selection) return menu && forceMenuPoint ? { ...selection, menu } : selection
    if (!menu) return

    const dragSelection = forceMenuPoint ? undefined : selectionFromDragPoints(menu)
    if (dragSelection) return dragSelection

    if (!forceMenuPoint) return
    const selectedText = window.getSelection?.()?.toString?.() ?? ""
    return selectionSnapshotFromTextAndPoint({
      selectedText,
      source: props.content,
      x: menu.x,
      y: menu.y,
    })
  }

  const commitSelection = (selection: PreviewTextSelection | undefined) => {
    if (!selection) {
      props.onSelectionChange?.(undefined)
      return
    }
    const handled = props.onSelectionContextMenu?.(selection, selection.menu)
    if (!handled) props.onSelectionChange?.(selection)
  }

  const emitSelection = (event?: MouseEvent) => {
    const point = event ? { x: event.clientX, y: event.clientY } : undefined
    const delays = [0, 24, 80, 160]

    const readSelection = (attempt: number) => {
      const selection = currentSelection(point)
      if (selection) {
        commitSelection(selection)
        return
      }

      const delay = delays[attempt]
      if (delay === undefined) {
        commitSelection(undefined)
        return
      }
      window.setTimeout(() => readSelection(attempt + 1), delay)
    }

    requestAnimationFrame(() => readSelection(0))
  }

  const scheduleSelectionFromSelectionChange = (point = lastPoint) => {
    if (selectionChangeTimer !== undefined) clearTimeout(selectionChangeTimer)
    selectionChangeTimer = window.setTimeout(() => {
      selectionChangeTimer = undefined
      if (!selectionBelongsToPreview()) return
      commitSelection(currentSelection(point))
    }, 40)
  }

  const emitContextMenu = (event: MouseEvent) => {
    const menu = { x: event.clientX, y: event.clientY }
    const handled = props.onSelectionContextMenu?.(currentSelection(menu, true), menu)
    if (!handled) return
    event.preventDefault()
    event.stopPropagation()
  }

  const emitMouseDown = (event: MouseEvent) => {
    if (event.button === 0) {
      selecting = true
      lastPoint = { x: event.clientX, y: event.clientY }
      dragStartPoint = lastPoint
      return
    }
    if (event.button === 2) emitContextMenu(event)
  }

  createEffect(() => {
    const handleSelectionChange = () => {
      if (selecting) return
      if (!selectionBelongsToPreview()) return
      scheduleSelectionFromSelectionChange()
    }
    const handleDocumentMouseUp = (event: MouseEvent) => {
      if (!selecting) return
      selecting = false
      lastPoint = { x: event.clientX, y: event.clientY }
      if (selectionBelongsToPreview()) scheduleSelectionFromSelectionChange(lastPoint)
    }

    document.addEventListener("selectionchange", handleSelectionChange)
    document.addEventListener("mouseup", handleDocumentMouseUp, true)
    onCleanup(() => {
      document.removeEventListener("selectionchange", handleSelectionChange)
      document.removeEventListener("mouseup", handleDocumentMouseUp, true)
      if (selectionChangeTimer !== undefined) clearTimeout(selectionChangeTimer)
    })
  })

  return (
    <div
      ref={previewRef}
      data-parvis-preview-selection-scope="true"
      class="px-6 py-4 pb-40 overflow-auto h-full markdown-file-preview select-text cursor-text"
      onMouseDown={emitMouseDown}
      onMouseUp={emitSelection}
      onKeyUp={() => emitSelection()}
      onContextMenu={emitContextMenu}
    >
      <Markdown text={props.content} />
    </div>
  )
}
