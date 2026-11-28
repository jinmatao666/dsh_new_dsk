/* oxlint-disable -- Parvis source retained with its original control flow and types; see preview-runtime/LICENSE. */
import { Search } from "lucide-solid"
import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js"
import type { JSX } from "solid-js"
import { PreviewShell, PreviewZoomControls } from "@/components/session/preview-shell"

type XlsxModule = typeof import("xlsx")
type SheetRange = ReturnType<XlsxModule["utils"]["decode_range"]>
type SheetCellRef = ReturnType<XlsxModule["utils"]["encode_cell"]>

const DEFAULT_COLUMN_WIDTH = 96
const DEFAULT_ROW_HEIGHT = 30
const ROW_HEADER_WIDTH = 52
const MAX_DIRECT_RENDER_CELLS = 40_000
const MAX_DIRECT_RENDER_COLUMNS = 220
const ZOOM_STEP = 0.1

export type SheetPreviewCell = {
  address: string
  rowIndex: number
  columnIndex: number
  display: string
  raw: unknown
  type?: string
  formula?: string
  format?: string
  hyperlink?: string
  style?: JSX.CSSProperties
}

export type SheetPreviewColumn = {
  index: number
  label: string
  width: number
}

export type SheetPreviewRow = {
  index: number
  label: string
  height: number
  cells: SheetPreviewGridCell[]
}

export type SheetPreviewGridCell = {
  cell: SheetPreviewCell
  rowSpan: number
  colSpan: number
}

export type SheetPreviewMerge = {
  startRow: number
  startColumn: number
  endRow: number
  endColumn: number
}

export type SheetPreview = {
  name: string
  ref?: string
  rows: SheetPreviewRow[]
  columns: SheetPreviewColumn[]
  merges: SheetPreviewMerge[]
  cellMap: Map<string, SheetPreviewCell>
  firstCellAddress?: string
  firstDataCellAddress?: string
  rowCount: number
  columnCount: number
  renderedRowCount: number
  renderedColumnCount: number
  tableWidth: number
  tableHeight: number
  truncatedRows: number
  truncatedColumns: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function cellText(value: unknown) {
  if (value === undefined || value === null) return ""
  if (value instanceof Date) return value.toLocaleString()
  return String(value)
}

function cssColor(color: unknown) {
  if (!color || typeof color !== "object") return undefined
  const value = (color as { rgb?: unknown }).rgb
  if (typeof value !== "string" || value.length < 6) return undefined
  const rgb = value.length >= 8 ? value.slice(-6) : value
  if (!/^[0-9a-fA-F]{6}$/.test(rgb)) return undefined
  return `#${rgb}`
}

function cellStyle(cell: Record<string, unknown> | undefined): JSX.CSSProperties | undefined {
  const style = cell?.s
  if (!style || typeof style !== "object") return undefined
  const record = style as Record<string, any>
  const result: JSX.CSSProperties = {}

  const fillColor = cssColor(record.fill?.fgColor) ?? cssColor(record.fill?.bgColor)
  if (fillColor) result["background-color"] = fillColor

  const font = record.font
  if (font && typeof font === "object") {
    if (font.bold) result["font-weight"] = "600"
    if (font.italic) result["font-style"] = "italic"
    if (font.underline) result["text-decoration"] = "underline"
    const color = cssColor(font.color)
    if (color) result.color = color
    if (typeof font.sz === "number") result["font-size"] = `${clamp(font.sz, 8, 28)}px`
  }

  const alignment = record.alignment
  if (alignment && typeof alignment === "object") {
    const horizontal = String(alignment.horizontal ?? "")
    if (horizontal === "center" || horizontal === "right" || horizontal === "left") {
      result["text-align"] = horizontal
    }
    const vertical = String(alignment.vertical ?? "")
    if (vertical === "top" || vertical === "middle" || vertical === "bottom") {
      result["vertical-align"] = vertical
    }
    if (alignment.wrapText) {
      result["white-space"] = "pre-wrap"
      result["word-break"] = "break-word"
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}

function columnWidth(column: Record<string, unknown> | undefined) {
  if (!column) return DEFAULT_COLUMN_WIDTH
  if (column.hidden) return 0
  if (typeof column.wpx === "number") return clamp(Math.round(column.wpx), 36, 360)
  if (typeof column.wch === "number") return clamp(Math.round(column.wch * 7 + 8), 36, 360)
  if (typeof column.width === "number") return clamp(Math.round(column.width * 7 + 8), 36, 360)
  return DEFAULT_COLUMN_WIDTH
}

function rowHeight(row: Record<string, unknown> | undefined) {
  if (!row) return DEFAULT_ROW_HEIGHT
  if (row.hidden) return 0
  if (typeof row.hpx === "number") return clamp(Math.round(row.hpx), 22, 140)
  if (typeof row.hpt === "number") return clamp(Math.round(row.hpt * 1.333), 22, 140)
  return DEFAULT_ROW_HEIGHT
}

function rangeSize(range: SheetRange) {
  return {
    rows: Math.max(0, range.e.r - range.s.r + 1),
    columns: Math.max(0, range.e.c - range.s.c + 1),
  }
}

function cellAddress(XLSX: XlsxModule, row: number, column: number): SheetCellRef {
  return XLSX.utils.encode_cell({ r: row, c: column })
}

function mergeKey(row: number, column: number) {
  return `${row}:${column}`
}

function buildMergeMaps(
  merges: SheetRange[],
  startRow: number,
  startColumn: number,
  endRow: number,
  endColumn: number,
) {
  const topLeft = new Map<string, { rowSpan: number; colSpan: number }>()
  const covered = new Set<string>()
  const visibleMerges: SheetPreviewMerge[] = []

  for (const merge of merges) {
    const start = {
      row: Math.max(startRow, merge.s.r),
      column: Math.max(startColumn, merge.s.c),
    }
    const end = {
      row: Math.min(endRow, merge.e.r),
      column: Math.min(endColumn, merge.e.c),
    }
    if (start.row > end.row || start.column > end.column) continue

    visibleMerges.push({
      startRow: merge.s.r,
      startColumn: merge.s.c,
      endRow: merge.e.r,
      endColumn: merge.e.c,
    })
    topLeft.set(mergeKey(start.row, start.column), {
      rowSpan: end.row - start.row + 1,
      colSpan: end.column - start.column + 1,
    })

    for (let row = start.row; row <= end.row; row++) {
      for (let column = start.column; column <= end.column; column++) {
        if (row === start.row && column === start.column) continue
        covered.add(mergeKey(row, column))
      }
    }
  }

  return { topLeft, covered, visibleMerges }
}

export function buildSheetPreview(XLSX: XlsxModule, name: string, sheet: Record<string, any>): SheetPreview {
  const fallbackRange = XLSX.utils.decode_range("A1:A1")
  const ref = typeof sheet["!ref"] === "string" ? sheet["!ref"] : undefined
  const range = ref ? XLSX.utils.decode_range(ref) : fallbackRange
  const size = rangeSize(range)
  const renderedColumnCount = Math.min(size.columns, MAX_DIRECT_RENDER_COLUMNS)
  const renderedRowCount = Math.min(
    size.rows,
    Math.max(1, Math.floor(MAX_DIRECT_RENDER_CELLS / Math.max(1, renderedColumnCount))),
  )
  const renderEndRow = range.s.r + Math.max(0, renderedRowCount - 1)
  const renderEndColumn = range.s.c + Math.max(0, renderedColumnCount - 1)
  const columnMeta = (sheet["!cols"] ?? []) as Array<Record<string, unknown> | undefined>
  const rowMeta = (sheet["!rows"] ?? []) as Array<Record<string, unknown> | undefined>
  const merges = (sheet["!merges"] ?? []) as SheetRange[]
  const mergeMaps = buildMergeMaps(merges, range.s.r, range.s.c, renderEndRow, renderEndColumn)
  const columns: SheetPreviewColumn[] = []
  const rows: SheetPreviewRow[] = []
  const cellMap = new Map<string, SheetPreviewCell>()
  let firstDataCellAddress: string | undefined

  for (let column = range.s.c; column <= renderEndColumn; column++) {
    columns.push({
      index: column,
      label: XLSX.utils.encode_col(column),
      width: columnWidth(columnMeta[column]),
    })
  }

  for (let row = range.s.r; row <= renderEndRow; row++) {
    const cells: SheetPreviewGridCell[] = []
    for (let column = range.s.c; column <= renderEndColumn; column++) {
      if (mergeMaps.covered.has(mergeKey(row, column))) continue

      const address = cellAddress(XLSX, row, column)
      const rawCell = sheet[address] as Record<string, unknown> | undefined
      const display = cellText(rawCell?.w ?? rawCell?.v)
      const cell: SheetPreviewCell = {
        address,
        rowIndex: row,
        columnIndex: column,
        display,
        raw: rawCell?.v,
        type: typeof rawCell?.t === "string" ? rawCell.t : undefined,
        formula: typeof rawCell?.f === "string" ? rawCell.f : undefined,
        format: typeof rawCell?.z === "string" ? rawCell.z : undefined,
        hyperlink:
          rawCell?.l && typeof rawCell.l === "object" && typeof (rawCell.l as { Target?: unknown }).Target === "string"
            ? (rawCell.l as { Target: string }).Target
            : undefined,
        style: cellStyle(rawCell),
      }
      if (!firstDataCellAddress && (display || cell.formula)) firstDataCellAddress = address
      cellMap.set(address, cell)
      const span = mergeMaps.topLeft.get(mergeKey(row, column))
      cells.push({
        cell,
        rowSpan: span?.rowSpan ?? 1,
        colSpan: span?.colSpan ?? 1,
      })
    }
    rows.push({
      index: row,
      label: String(row + 1),
      height: rowHeight(rowMeta[row]),
      cells,
    })
  }

  const tableWidth = ROW_HEADER_WIDTH + columns.reduce((sum, column) => sum + column.width, 0)
  const tableHeight = 32 + rows.reduce((sum, row) => sum + row.height, 0)

  return {
    name,
    ref,
    rows,
    columns,
    merges: mergeMaps.visibleMerges,
    cellMap,
    firstCellAddress: rows[0]?.cells[0]?.cell.address,
    firstDataCellAddress,
    rowCount: size.rows,
    columnCount: size.columns,
    renderedRowCount,
    renderedColumnCount,
    tableWidth,
    tableHeight,
    truncatedRows: Math.max(0, size.rows - renderedRowCount),
    truncatedColumns: Math.max(0, size.columns - renderedColumnCount),
  }
}

function buildWorkbookPreview(XLSX: XlsxModule, buffer: ArrayBuffer, path?: string) {
  const workbook = XLSX.read(buffer, {
    type: "array",
    codepage: /\.(?:csv|tsv)$/i.test(path ?? "") ? 65001 : undefined,
    cellStyles: true,
    cellNF: true,
    cellDates: true,
  })
  return workbook.SheetNames.map((name) => buildSheetPreview(XLSX, name, workbook.Sheets[name] ?? {}))
}

function formatFormula(cell: SheetPreviewCell | undefined) {
  if (!cell?.formula) return ""
  return cell.formula.startsWith("=") ? cell.formula : `=${cell.formula}`
}

function selectedLabel(cell: SheetPreviewCell | undefined) {
  if (!cell) return "-"
  return `${cell.address}${cell.formula ? "  fx" : ""}`
}

function cellTitle(cell: SheetPreviewCell) {
  const parts = [cell.address]
  if (cell.display) parts.push(cell.display)
  if (cell.formula) parts.push(formatFormula(cell))
  if (cell.hyperlink) parts.push(cell.hyperlink)
  return parts.join("\n")
}

export const XlsxRenderer: Component<{ buffer: ArrayBuffer; path?: string }> = (props) => {
  let viewportRef: HTMLDivElement | undefined
  let tableFrameRef: HTMLDivElement | undefined
  let sheetTabsRef: HTMLDivElement | undefined
  let sheetTabsContentRef: HTMLDivElement | undefined
  let horizontalResizeObserver: ResizeObserver | undefined
  let sheetTabsResizeObserver: ResizeObserver | undefined
  let sheetTabsActivePointerId: number | undefined
  let sheetTabsThumbGrabOffset = 0
  let loadGeneration = 0
  const [error, setError] = createSignal<string>()
  const [loading, setLoading] = createSignal(true)
  const [sheets, setSheets] = createSignal<SheetPreview[]>([])
  const [activeSheet, setActiveSheet] = createSignal(0)
  const [selectedAddress, setSelectedAddress] = createSignal<string>()
  const [searchQuery, setSearchQuery] = createSignal("")
  const [zoom, setZoom] = createSignal(1)
  const [horizontalScrollLeft, setHorizontalScrollLeft] = createSignal(0)
  const [horizontalScrollMax, setHorizontalScrollMax] = createSignal(0)
  const [sheetTabsScrollLeft, setSheetTabsScrollLeft] = createSignal(0)
  const [sheetTabsScrollMax, setSheetTabsScrollMax] = createSignal(0)
  const [sheetTabsViewportWidth, setSheetTabsViewportWidth] = createSignal(0)
  const [sheetTabsContentWidth, setSheetTabsContentWidth] = createSignal(0)
  const [sheetTabsHovered, setSheetTabsHovered] = createSignal(false)
  const [sheetTabsDragging, setSheetTabsDragging] = createSignal(false)

  const activePreview = createMemo(() => sheets()[activeSheet()])
  const selectedCell = createMemo(() => {
    const sheet = activePreview()
    const address = selectedAddress()
    return sheet && address ? sheet.cellMap.get(address) : undefined
  })
  const stageSize = createMemo(() => {
    const sheet = activePreview()
    return {
      width: Math.max(1, (sheet?.tableWidth ?? 960) * zoom()),
      height: Math.max(1, (sheet?.tableHeight ?? 540) * zoom()),
    }
  })
  const searchMatches = createMemo(() => {
    const query = searchQuery().trim().toLowerCase()
    const sheet = activePreview()
    if (!query || !sheet) return []
    const matches: SheetPreviewCell[] = []
    for (const cell of sheet.cellMap.values()) {
      if (!cell.display && !cell.formula) continue
      const haystack = `${cell.display}\n${formatFormula(cell)}`.toLowerCase()
      if (haystack.includes(query)) matches.push(cell)
    }
    return matches
  })
  const matchAddressSet = createMemo(() => new Set(searchMatches().map((cell) => cell.address)))
  const currentMatchAddress = createMemo(() => searchMatches()[0]?.address)

  const clampZoom = (value: number) => Math.min(2, Math.max(0.5, value))

  const updateHorizontalScroll = () => {
    const viewport = viewportRef
    if (!viewport) {
      setHorizontalScrollLeft(0)
      setHorizontalScrollMax(0)
      return
    }
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    setHorizontalScrollMax(max)
    setHorizontalScrollLeft(clamp(viewport.scrollLeft, 0, max))
  }

  createEffect(() => {
    const buffer = props.buffer
    const generation = ++loadGeneration
    setLoading(true)
    setError(undefined)
    void (async () => {
      try {
        const XLSX = await import("xlsx")
        const previews = buildWorkbookPreview(XLSX, buffer, props.path)
        if (generation !== loadGeneration) return
        setSheets(previews)
        setActiveSheet(0)
        setSelectedAddress(previews[0]?.firstDataCellAddress ?? previews[0]?.firstCellAddress)
        setLoading(false)
      } catch (e) {
        if (generation !== loadGeneration) return
        setError(e instanceof Error ? e.message : "解析表格失败")
        setLoading(false)
      }
    })()
  })

  const updateSheetTabsScrollState = () => {
    const tabs = sheetTabsRef
    if (!tabs) {
      setSheetTabsScrollLeft(0)
      setSheetTabsScrollMax(0)
      setSheetTabsViewportWidth(0)
      setSheetTabsContentWidth(0)
      return
    }
    const content = sheetTabsContentRef
    const viewportWidth = tabs.clientWidth
    const contentWidth = Math.max(tabs.scrollWidth, content?.scrollWidth ?? 0, content?.offsetWidth ?? 0)
    const max = Math.max(0, contentWidth - viewportWidth)
    const left = clamp(tabs.scrollLeft, 0, max)
    if (tabs.scrollLeft !== left) tabs.scrollLeft = left
    setSheetTabsScrollLeft(left)
    setSheetTabsScrollMax(max)
    setSheetTabsViewportWidth(viewportWidth)
    setSheetTabsContentWidth(contentWidth)
  }

  const resetSheetTabsResizeObserver = () => {
    sheetTabsResizeObserver?.disconnect()
    sheetTabsResizeObserver = new ResizeObserver(updateSheetTabsScrollState)
    if (sheetTabsRef) sheetTabsResizeObserver.observe(sheetTabsRef)
    if (sheetTabsContentRef) sheetTabsResizeObserver.observe(sheetTabsContentRef)
    requestAnimationFrame(updateSheetTabsScrollState)
  }

  const setViewport = (el: HTMLDivElement) => {
    viewportRef = el
    horizontalResizeObserver?.disconnect()
    horizontalResizeObserver = new ResizeObserver(updateHorizontalScroll)
    horizontalResizeObserver.observe(el)
    if (tableFrameRef) horizontalResizeObserver.observe(tableFrameRef)
    requestAnimationFrame(updateHorizontalScroll)
  }

  const setTableFrame = (el: HTMLDivElement) => {
    tableFrameRef = el
    horizontalResizeObserver?.observe(el)
    requestAnimationFrame(updateHorizontalScroll)
  }

  const setSheetTabsViewport = (el: HTMLDivElement) => {
    sheetTabsRef = el
    resetSheetTabsResizeObserver()
  }

  const setSheetTabsContent = (el: HTMLDivElement) => {
    sheetTabsContentRef = el
    resetSheetTabsResizeObserver()
  }

  const revealAddress = (address: string | undefined, smooth = true) => {
    if (!address) return
    requestAnimationFrame(() => {
      const viewport = viewportRef
      const frame = tableFrameRef
      const target = frame?.querySelector<HTMLElement>(`[data-cell-address="${address}"]`)
      if (!viewport || !target) return
      const scale = zoom()
      const left = Math.max(0, target.offsetLeft * scale - 96)
      const top = Math.max(0, target.offsetTop * scale - 84)
      const right = (target.offsetLeft + target.offsetWidth) * scale + 48
      const bottom = (target.offsetTop + target.offsetHeight) * scale + 48
      const nextLeft =
        left < viewport.scrollLeft
          ? left
          : right > viewport.scrollLeft + viewport.clientWidth
            ? Math.max(0, right - viewport.clientWidth)
            : viewport.scrollLeft
      const nextTop =
        top < viewport.scrollTop
          ? top
          : bottom > viewport.scrollTop + viewport.clientHeight
            ? Math.max(0, bottom - viewport.clientHeight)
            : viewport.scrollTop
      viewport.scrollTo({
        left: nextLeft,
        top: nextTop,
        behavior: smooth ? "smooth" : "auto",
      })
    })
  }

  createEffect(() => {
    const sheet = activePreview()
    setSelectedAddress(sheet?.firstDataCellAddress ?? sheet?.firstCellAddress)
    requestAnimationFrame(() => {
      if (viewportRef) {
        viewportRef.scrollLeft = 0
        viewportRef.scrollTop = 0
      }
      updateHorizontalScroll()
    })
  })

  createEffect(() => {
    zoom()
    requestAnimationFrame(updateHorizontalScroll)
  })

  createEffect(() => {
    const _sheetCount = sheets().length
    requestAnimationFrame(updateSheetTabsScrollState)
  })

  createEffect(() => {
    const matches = searchMatches()
    if (matches.length > 0) {
      const address = matches[0]?.address
      setSelectedAddress(address)
      revealAddress(address)
    }
  })

  onCleanup(() => {
    horizontalResizeObserver?.disconnect()
    sheetTabsResizeObserver?.disconnect()
  })

  const selectCell = (cell: SheetPreviewCell) => {
    setSelectedAddress(cell.address)
  }

  const zoomBy = (delta: number) => setZoom((value) => clampZoom(Number((value + delta).toFixed(2))))
  const fitToWidth = () => {
    const viewport = viewportRef
    const sheet = activePreview()
    if (!viewport || !sheet) return
    const available = Math.max(240, viewport.clientWidth - 40)
    setZoom(clampZoom(available / sheet.tableWidth))
  }
  const setHorizontalScroll = (value: number) => {
    const viewport = viewportRef
    if (!viewport) return
    const next = clamp(value, 0, horizontalScrollMax())
    viewport.scrollLeft = next
    setHorizontalScrollLeft(next)
  }
  const sheetTabsThumbMetrics = createMemo(() => {
    const viewport = sheetTabsViewportWidth()
    const content = sheetTabsContentWidth()
    const max = sheetTabsScrollMax()
    if (viewport <= 0) return { left: 0, width: 0 }
    if (content <= viewport || max <= 0) return { left: 0, width: viewport }
    const width = clamp(viewport * (viewport / content), Math.min(36, viewport), viewport)
    return {
      left: (viewport - width) * (sheetTabsScrollLeft() / max),
      width,
    }
  })
  const setSheetTabsLeft = (value: number) => {
    const tabs = sheetTabsRef
    if (!tabs) return
    tabs.scrollLeft = clamp(value, 0, sheetTabsScrollMax())
    updateSheetTabsScrollState()
  }
  const moveSheetTabsThumb = (clientX: number, track: HTMLElement) => {
    const metrics = sheetTabsThumbMetrics()
    const max = sheetTabsScrollMax()
    if (max <= 0 || metrics.width <= 0) return
    const rect = track.getBoundingClientRect()
    const travel = Math.max(1, rect.width - metrics.width)
    const left = clamp(clientX - rect.left - sheetTabsThumbGrabOffset, 0, travel)
    setSheetTabsLeft((left / travel) * max)
  }
  const endSheetTabsDrag = (event: PointerEvent & { currentTarget: HTMLElement }) => {
    if (sheetTabsActivePointerId !== event.pointerId) return
    sheetTabsActivePointerId = undefined
    setSheetTabsDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const sheetTabs = (
    <Show when={sheets().length > 0}>
      <>
        <style>
          {`
            .parvis-xlsx-sheet-tabs {
              scrollbar-width: none;
            }
            .parvis-xlsx-sheet-tabs::-webkit-scrollbar {
              display: none;
              height: 0;
              width: 0;
            }
            .parvis-xlsx-sheet-tabs-scrollbar {
              pointer-events: none;
              opacity: 0;
              transition: opacity 120ms ease;
            }
            .parvis-xlsx-sheet-tabs-scrollbar[data-visible="true"] {
              pointer-events: auto;
              opacity: 1;
            }
            .parvis-xlsx-sheet-tabs-scrollbar-rail {
              background: var(--surface-base-active);
              box-shadow: inset 0 0 0 1px var(--border-weak-base);
            }
            .parvis-xlsx-sheet-tabs-scrollbar-thumb {
              background: var(--text-weak);
              border: 1px solid var(--border-base);
              box-shadow: var(--shadow-xs);
            }
            .parvis-xlsx-sheet-tabs-scrollbar:hover .parvis-xlsx-sheet-tabs-scrollbar-thumb,
            .parvis-xlsx-sheet-tabs-scrollbar[data-dragging="true"] .parvis-xlsx-sheet-tabs-scrollbar-thumb {
              background: var(--text-strong);
            }
          `}
        </style>
        <div
          class="relative h-10 min-w-0 w-full max-w-[min(68vw,980px)]"
          onMouseEnter={() => {
            updateSheetTabsScrollState()
            requestAnimationFrame(updateSheetTabsScrollState)
            setSheetTabsHovered(true)
          }}
          onMouseLeave={() => {
            if (!sheetTabsDragging()) setSheetTabsHovered(false)
          }}
        >
          <div
            ref={setSheetTabsViewport}
            class="parvis-xlsx-sheet-tabs flex h-full min-w-0 w-full items-center overflow-x-auto py-1.5"
            onScroll={updateSheetTabsScrollState}
            onWheel={(event) => {
              const target = event.currentTarget
              updateSheetTabsScrollState()
              if (sheetTabsScrollMax() <= 0) return
              if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
              event.preventDefault()
              target.scrollLeft += event.deltaY
              updateSheetTabsScrollState()
            }}
          >
            <div ref={setSheetTabsContent} class="flex h-full min-w-max items-center gap-1">
              <For each={sheets()}>
                {(sheet, i) => (
                  <button
                    type="button"
                    class={`h-7 shrink-0 rounded-md px-2 text-xs transition-colors ${
                      activeSheet() === i()
                        ? "bg-surface-active text-text-strong"
                        : "text-text-weak hover:bg-surface-hover hover:text-text-default"
                    }`}
                    onClick={() => setActiveSheet(i())}
                    title={`${sheet.name} · ${sheet.rowCount} 行 × ${sheet.columnCount} 列`}
                  >
                    {sheet.name}
                  </button>
                )}
              </For>
            </div>
          </div>
          <div
            class="parvis-xlsx-sheet-tabs-scrollbar absolute bottom-0 left-0 right-0 z-20 h-3 cursor-pointer"
            data-visible={sheetTabsScrollMax() > 1 && (sheetTabsHovered() || sheetTabsDragging()) ? "true" : "false"}
            data-dragging={sheetTabsDragging() ? "true" : "false"}
            onPointerDown={(event) => {
              if (event.button !== 0 || sheetTabsScrollMax() <= 0) return
              event.preventDefault()
              const thumb = (event.target as HTMLElement).closest("[data-sheet-tabs-thumb]") as HTMLElement | null
              const thumbRect = thumb?.getBoundingClientRect()
              sheetTabsThumbGrabOffset = thumbRect ? event.clientX - thumbRect.left : sheetTabsThumbMetrics().width / 2
              sheetTabsActivePointerId = event.pointerId
              setSheetTabsDragging(true)
              event.currentTarget.setPointerCapture(event.pointerId)
              moveSheetTabsThumb(event.clientX, event.currentTarget)
            }}
            onPointerMove={(event) => {
              if (sheetTabsActivePointerId === event.pointerId) moveSheetTabsThumb(event.clientX, event.currentTarget)
            }}
            onPointerUp={endSheetTabsDrag}
            onPointerCancel={endSheetTabsDrag}
          >
            <div class="parvis-xlsx-sheet-tabs-scrollbar-rail absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full" />
            <div
              data-sheet-tabs-thumb
              class="parvis-xlsx-sheet-tabs-scrollbar-thumb absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full"
              style={{
                left: `${sheetTabsThumbMetrics().left}px`,
                width: `${sheetTabsThumbMetrics().width}px`,
              }}
            />
          </div>
        </div>
      </>
    </Show>
  )

  const searchControls = (
    <Show when={!loading() && activePreview()}>
      <div class="flex min-w-0 w-[clamp(112px,16vw,220px)] items-center">
        <div class="relative min-w-0 flex-1">
          <Search size={14} class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-weak" />
          <input
            value={searchQuery()}
            placeholder="搜索"
            class="h-7 w-full rounded-md border border-border-weak-base bg-surface-raised-base py-0 pl-7 pr-9 text-xs text-text-default outline-none transition-colors placeholder:text-text-disabled focus:border-border-strong"
            onInput={(event) => setSearchQuery(event.currentTarget.value)}
          />
          <Show when={searchQuery().trim()}>
            <div class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-text-weak">
              {searchMatches().length}
            </div>
          </Show>
        </div>
      </div>
    </Show>
  )

  return (
    <Switch>
      <Match when={error()}>
        <PreviewShell>
          <div class="px-6 py-4 text-text-weak">{error()}</div>
        </PreviewShell>
      </Match>
      <Match when={true}>
        <div class="flex h-full min-h-0 min-w-0 flex-col bg-background-base text-text-default">
          <style>
            {`
              .parvis-xlsx-grid-viewport {
                overflow-x: scroll !important;
                scrollbar-width: none;
              }
              .parvis-xlsx-grid-viewport::-webkit-scrollbar {
                display: none;
              }
              .parvis-xlsx-horizontal-slider {
                appearance: none;
                display: block;
                width: 100%;
                height: 12px;
                background: transparent;
                cursor: pointer;
              }
              .parvis-xlsx-horizontal-slider::-webkit-slider-runnable-track {
                height: 4px;
                border-radius: 999px;
                background: var(--surface-base-active);
              }
              .parvis-xlsx-horizontal-slider::-webkit-slider-thumb {
                appearance: none;
                width: 48px;
                height: 10px;
                margin-top: -3px;
                border: 1px solid var(--border-base);
                border-radius: 999px;
                background: var(--surface-raised-stronger-non-alpha);
                box-shadow: var(--shadow-xs);
              }
              .parvis-xlsx-horizontal-slider::-moz-range-track {
                height: 4px;
                border: 0;
                border-radius: 999px;
                background: var(--surface-base-active);
              }
              .parvis-xlsx-horizontal-slider::-moz-range-thumb {
                width: 48px;
                height: 10px;
                border: 1px solid var(--border-base);
                border-radius: 999px;
                background: var(--surface-raised-stronger-non-alpha);
                box-shadow: var(--shadow-xs);
              }
              .parvis-xlsx-horizontal-slider:focus-visible {
                outline: 1px solid var(--border-strong-base);
                outline-offset: 1px;
              }
            `}
          </style>
          <Show when={sheets().length > 0}>
            <div data-slot="xlsx-sheet-toolbar" class="flex h-11 shrink-0 items-center bg-background-base px-3">
              {sheetTabs}
            </div>
          </Show>
          <Show when={!loading() && activePreview()}>
            {(sheet) => (
              <div
                data-slot="xlsx-formula-toolbar"
                class="flex h-10 shrink-0 items-center gap-2 bg-background-base px-3 text-xs"
              >
                <div class="flex h-7 w-20 shrink-0 items-center rounded-md border border-border-weak-base bg-surface-raised-base px-2 font-mono text-[11px] text-text-default">
                  {selectedLabel(selectedCell())}
                </div>
                <div class="shrink-0 font-mono text-[11px] text-text-weak">fx</div>
                <div
                  class="flex h-7 min-w-0 flex-1 cursor-text select-text items-center overflow-x-auto whitespace-nowrap rounded-md border border-border-weak-base bg-surface-raised-base px-2 text-[12px] text-text-default"
                  style={{ "scrollbar-width": "thin" }}
                >
                  {formatFormula(selectedCell()) || selectedCell()?.display || ""}
                </div>
                <Show when={sheet().truncatedRows || sheet().truncatedColumns}>
                  <div class="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                    仅渲染前 {sheet().renderedRowCount} 行 × {sheet().renderedColumnCount} 列
                  </div>
                </Show>
                <div class="ml-auto min-w-0 shrink-0">{searchControls}</div>
              </div>
            )}
          </Show>
          <div class="min-h-0 flex-1">
            <PreviewShell
              bottomControls={
                <PreviewZoomControls
                  zoom={zoom()}
                  min={0.5}
                  max={2}
                  onZoomOut={() => zoomBy(-ZOOM_STEP)}
                  onZoomIn={() => zoomBy(ZOOM_STEP)}
                  onZoomChange={(value) => setZoom(clampZoom(value))}
                  onFitWidth={fitToWidth}
                />
              }
              viewportFooter={
                horizontalScrollMax() > 0 ? (
                  <div data-slot="xlsx-horizontal-scrollbar" class="h-3 bg-surface-weak px-1">
                    <input
                      type="range"
                      min="0"
                      max={horizontalScrollMax()}
                      step="1"
                      value={horizontalScrollLeft()}
                      class="parvis-xlsx-horizontal-slider"
                      onInput={(event) => setHorizontalScroll(Number(event.currentTarget.value))}
                      aria-label="工作表横向滚动位置"
                    />
                  </div>
                ) : undefined
              }
              viewportRef={setViewport}
              viewportClass="parvis-xlsx-grid-viewport overflow-x-scroll bg-white p-0 dark:bg-background-stronger"
              onViewportScroll={updateHorizontalScroll}
            >
              <Show when={loading()}>
                <div class="px-6 py-4 text-text-weak">正在加载表格...</div>
              </Show>
              <Show when={!loading() && activePreview()}>
                {(sheet) => (
                  <div class="p-3">
                    <div
                      class="relative"
                      style={{
                        width: `${stageSize().width}px`,
                        height: `${stageSize().height}px`,
                      }}
                    >
                      <div
                        ref={setTableFrame}
                        class="absolute left-0 top-0 rounded-md border border-border-weak-base bg-white shadow-sm dark:bg-surface-raised-stronger-non-alpha"
                        style={{
                          transform: `scale(${zoom()})`,
                          "transform-origin": "top left",
                        }}
                      >
                        <table
                          class="border-separate border-spacing-0 table-fixed bg-white text-[13px] text-slate-900 dark:bg-surface-raised-stronger-non-alpha dark:text-text-strong"
                          style={{
                            width: `${sheet().tableWidth}px`,
                          }}
                        >
                          <colgroup>
                            <col style={{ width: `${ROW_HEADER_WIDTH}px` }} />
                            <For each={sheet().columns}>
                              {(column) => <col style={{ width: `${column.width}px` }} />}
                            </For>
                          </colgroup>
                          <thead>
                            <tr style={{ height: "32px" }}>
                              <th class="border-b border-r border-border-weak-base bg-slate-100 text-[11px] font-medium text-slate-500 dark:bg-surface-raised-base dark:text-text-weak" />
                              <For each={sheet().columns}>
                                {(column) => (
                                  <th
                                    class="border-b border-r border-border-weak-base bg-slate-100 px-2 text-center text-[11px] font-medium text-slate-600 dark:bg-surface-raised-base dark:text-text-weak"
                                    classList={{
                                      "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300":
                                        selectedCell()?.columnIndex === column.index,
                                    }}
                                  >
                                    {column.label}
                                  </th>
                                )}
                              </For>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={sheet().rows}>
                              {(row) => (
                                <tr style={{ height: `${row.height}px` }}>
                                  <th
                                    class="border-b border-r border-border-weak-base bg-slate-100 px-2 text-right text-[11px] font-medium text-slate-600 dark:bg-surface-raised-base dark:text-text-weak"
                                    classList={{
                                      "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300":
                                        selectedCell()?.rowIndex === row.index,
                                    }}
                                  >
                                    {row.label}
                                  </th>
                                  <For each={row.cells}>
                                    {(entry) => {
                                      const cell = entry.cell
                                      const selected = () => selectedAddress() === cell.address
                                      const matched = () => matchAddressSet().has(cell.address)
                                      const currentMatched = () => currentMatchAddress() === cell.address
                                      return (
                                        <td
                                          data-cell-address={cell.address}
                                          rowSpan={entry.rowSpan}
                                          colSpan={entry.colSpan}
                                          title={cellTitle(cell)}
                                          class="relative cursor-text select-text overflow-hidden border-b border-r border-border-weak-base bg-white px-2 py-1 align-middle leading-5 text-slate-900 dark:bg-surface-raised-stronger-non-alpha"
                                          classList={{
                                            "dark:text-text-strong": !cell.style?.["background-color"],
                                            "bg-yellow-100/80 dark:bg-yellow-900/50":
                                              matched() && !currentMatched() && !selected(),
                                            "bg-amber-200/90 dark:bg-amber-800/60": currentMatched() && !selected(),
                                            "ring-1 ring-inset ring-yellow-400":
                                              matched() && !currentMatched() && !selected(),
                                            "ring-2 ring-inset ring-amber-500": currentMatched() && !selected(),
                                            "ring-2 ring-inset ring-blue-500 dark:ring-blue-400": selected(),
                                            "text-blue-700 underline decoration-blue-300 dark:text-blue-300 dark:decoration-blue-600":
                                              Boolean(cell.hyperlink),
                                          }}
                                          style={{
                                            ...cell.style,
                                            "max-width": `${Math.max(48, (sheet().columns[cell.columnIndex - sheet().columns[0]!.index]?.width ?? DEFAULT_COLUMN_WIDTH) * entry.colSpan)}px`,
                                          }}
                                          onClick={() => selectCell(cell)}
                                        >
                                          <span class="block min-h-5 truncate">{cell.display}</span>
                                          <Show when={cell.formula}>
                                            <span class="absolute right-0 top-0 h-0 w-0 border-l-[7px] border-t-[7px] border-l-transparent border-t-emerald-500" />
                                          </Show>
                                        </td>
                                      )
                                    }}
                                  </For>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </Show>
            </PreviewShell>
          </div>
        </div>
      </Match>
    </Switch>
  )
}
