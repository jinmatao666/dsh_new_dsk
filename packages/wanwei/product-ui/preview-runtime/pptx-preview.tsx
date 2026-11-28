/* oxlint-disable -- Parvis source retained with its original control flow and types; see preview-runtime/LICENSE. */
import { ChevronLeft, ChevronRight, PanelBottomClose, PanelBottomOpen } from "lucide-solid"
import { Component, createEffect, createSignal, createUniqueId, For, Match, onCleanup, Show, Switch, untrack } from "solid-js"
import type JSZip from "jszip"
import { FilePreviewFallback } from "@/components/session/file-preview-fallback"

const EMU_PER_PX = 9525
const DEFAULT_SLIDE_WIDTH_EMU = 12192000
const DEFAULT_SLIDE_HEIGHT_EMU = 6858000

type ThemeColors = Record<string, string>

type Paint = {
  color: string
  opacity: number
  gradient?: GradientPaint
}

type GradientPaint = {
  angle: number
  stops: GradientStop[]
}

type GradientStop = {
  offset: number
  color: string
  opacity: number
}

type ShadowEffect = {
  dx: number
  dy: number
  blur: number
  color: string
  opacity: number
}

type TextRun = {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  fontSize: number
  fontFamily?: string
  shadow?: string
}

type TextParagraph = {
  runs: TextRun[]
  align: "left" | "center" | "right" | "justify"
  bullet?: string
  lineHeight: number
  marginLeft?: number
}

type TextBlock = {
  paragraphs: TextParagraph[]
  inset: {
    top: number
    right: number
    bottom: number
    left: number
  }
  verticalAlign: "flex-start" | "center" | "flex-end"
  autoFit?: "shape" | "font"
  noWrap?: boolean
}

type BaseElement = {
  id: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
}

type ShapeElement = BaseElement & {
  kind: "shape"
  shape: string
  adjustments?: Record<string, number>
  customPath?: string
  customPoints?: [number, number][]
  fill?: Paint
  imageFill?: ImageFill
  stroke?: Paint
  strokeWidth: number
  strokeDash?: string
  shadow?: ShadowEffect
  text?: TextBlock
}

type ImageFill = {
  src: string
}

type ImageCrop = {
  left: number
  top: number
  right: number
  bottom: number
}

type ImageElement = BaseElement & {
  kind: "image"
  src: string
  opacity: number
  crop?: ImageCrop
  softEdge?: number
}

type LineElement = BaseElement & {
  kind: "line"
  stroke?: Paint
  strokeWidth: number
  strokeDash?: string
}

type TableCell = {
  x: number
  y: number
  width: number
  height: number
  fill?: Paint
  text?: TextBlock
}

type TableElement = BaseElement & {
  kind: "table"
  cells: TableCell[]
  stroke?: Paint
}

type ChartPoint = {
  label: string
  value: number
  color?: string
}

type ChartElement = BaseElement & {
  kind: "chart"
  chartType: "pie" | "bar"
  title?: string
  xAxisTitle?: string
  yAxisTitle?: string
  axisMin?: number
  axisMax?: number
  axisMajorUnit?: number
  points: ChartPoint[]
  colors: string[]
  showGridLines?: boolean
}

type SlideElement = ShapeElement | ImageElement | LineElement | TableElement | ChartElement

type SlideComment = {
  text: string
  author?: string
  initials?: string
  date?: string
}

type CommentAuthor = {
  name?: string
  initials?: string
}

type Slide = {
  id: string
  index: number
  title: string
  notes: string[]
  comments: SlideComment[]
  background: Paint
  elements: SlideElement[]
}

type SlideReference = {
  id: string
  index: number
  path: string
  title: string
}

type Deck = {
  width: number
  height: number
  slides: SlideReference[]
  loadSlide: (index: number) => Promise<Slide>
  dispose: () => void
}

type Relationship = {
  target: string
  type: string
  external: boolean
}

type Transform = {
  x: number
  y: number
  width: number
  height: number
  rotation?: number
}

type TransformContext = {
  x: number
  y: number
  scaleX: number
  scaleY: number
}

type TextRenderOptions = {
  expandHeight?: boolean
}

type PlaceholderKey = {
  type?: string
  idx?: string
}

type PlaceholderDefinition = {
  element: Element
}

type SlideTreeParseOptions = {
  inheritedPlaceholders?: Map<string, PlaceholderDefinition>
  skipPlaceholderElements?: boolean
}

type ImageSourceStore = {
  cache: Map<string, string>
  objectUrls: Set<string>
  disposed: boolean
}

const defaultThemeColors: ThemeColors = {
  dk1: "#000000",
  lt1: "#ffffff",
  dk2: "#1f497d",
  lt2: "#eeece1",
  accent1: "#4f81bd",
  accent2: "#c0504d",
  accent3: "#9bbb59",
  accent4: "#8064a2",
  accent5: "#4bacc6",
  accent6: "#f79646",
  hlink: "#0000ff",
  folHlink: "#800080",
  tx1: "#000000",
  bg1: "#ffffff",
  tx2: "#1f497d",
  bg2: "#eeece1",
}

const presetColors: Record<string, string> = {
  black: "#000000",
  blue: "#0000ff",
  cyan: "#00ffff",
  gray: "#808080",
  green: "#008000",
  magenta: "#ff00ff",
  orange: "#ffa500",
  purple: "#800080",
  red: "#ff0000",
  white: "#ffffff",
  yellow: "#ffff00",
}

const chartPalette = ["#2d6a4f", "#40916c", "#95d5b2", "#e9c46a", "#52b788", "#74c69d", "#a8dadc", "#1b4332"]

const imageMimeTypes: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
}

function canUseBlobImageUrls(): boolean {
  return typeof URL !== "undefined" && typeof URL.createObjectURL === "function" && typeof Blob !== "undefined"
}

function disposeImageSources(store: ImageSourceStore) {
  store.disposed = true
  for (const url of store.objectUrls) URL.revokeObjectURL(url)
  store.objectUrls.clear()
  store.cache.clear()
}

async function loadImageSource(zip: JSZip, imagePath: string, store: ImageSourceStore): Promise<string | undefined> {
  if (store.disposed) return undefined

  const cached = store.cache.get(imagePath)
  if (cached) return cached

  const file = zip.file(imagePath)
  if (!file) return undefined

  const extension = imagePath.split(".").pop()?.toLowerCase() ?? "png"
  const mime = imageMimeTypes[extension] ?? "application/octet-stream"
  let src: string

  if (canUseBlobImageUrls()) {
    const blob = await file.async("blob")
    if (store.disposed) return undefined
    const typedBlob = blob.type || mime === "application/octet-stream" ? blob : blob.slice(0, blob.size, mime)
    src = URL.createObjectURL(typedBlob)
    if (store.disposed) {
      URL.revokeObjectURL(src)
      return undefined
    }
    store.objectUrls.add(src)
  } else {
    const base64 = await file.async("base64")
    if (store.disposed) return undefined
    src = `data:${mime};base64,${base64}`
  }

  store.cache.set(imagePath, src)
  return src
}

function emuToPx(value: number): number {
  return value / EMU_PER_PX
}

function attr(element: Element | undefined | null, name: string): string | undefined {
  if (!element) return undefined
  return element.getAttribute(name) ?? undefined
}

function localAttr(element: Element | undefined | null, name: string): string | undefined {
  if (!element) return undefined
  const direct = element.getAttribute(name)
  if (direct !== null) return direct
  for (const item of Array.from(element.attributes)) {
    if (item.localName === name) return item.value
  }
  return undefined
}

function relAttr(element: Element | undefined | null): string | undefined {
  if (!element) return undefined
  return (
    element.getAttribute("r:id") ??
    element.getAttribute("r:embed") ??
    element.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ??
    element.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed") ??
    undefined
  )
}

function numericAttr(element: Element | undefined | null, name: string, fallback = 0): number {
  const value = localAttr(element, name)
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function children(element: Element | Document | undefined | null, localName?: string): Element[] {
  if (!element) return []
  const list = element instanceof Document ? element.documentElement.children : element.children
  const all = Array.from(list) as Element[]
  return localName ? all.filter((child) => child.localName === localName) : all
}

function child(element: Element | Document | undefined | null, localName: string): Element | undefined {
  return children(element, localName)[0]
}

function descendants(element: Element | Document | undefined | null, localName: string): Element[] {
  if (!element) return []
  const root = element instanceof Document ? element.documentElement : element
  return (Array.from(root.getElementsByTagName("*")) as Element[]).filter((item) => item.localName === localName)
}

function firstDescendant(element: Element | Document | undefined | null, localName: string): Element | undefined {
  return descendants(element, localName)[0]
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml")
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("PowerPoint XML 解析失败")
  }
  return doc
}

function relsPathFor(partPath: string): string {
  const normalized = partPath.replace(/^\/+/, "")
  const slash = normalized.lastIndexOf("/")
  if (slash < 0) return `_rels/${normalized}.rels`
  const dir = normalized.slice(0, slash)
  const file = normalized.slice(slash + 1)
  return `${dir}/_rels/${file}.rels`
}

function resolvePartPath(sourcePart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1)
  const parts = sourcePart.replace(/^\/+/, "").split("/")
  parts.pop()
  for (const segment of target.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") parts.pop()
    else parts.push(segment)
  }
  return parts.join("/")
}

async function readZipText(zip: JSZip, partPath: string): Promise<string | undefined> {
  const file = zip.file(partPath)
  return file ? await file.async("text") : undefined
}

async function parseRelationships(zip: JSZip, partPath: string): Promise<Map<string, Relationship>> {
  const text = await readZipText(zip, relsPathFor(partPath))
  const result = new Map<string, Relationship>()
  if (!text) return result

  const doc = parseXml(text)
  for (const relationship of descendants(doc, "Relationship")) {
    const id = attr(relationship, "Id")
    const target = attr(relationship, "Target")
    if (!id || !target) continue
    const external = attr(relationship, "TargetMode") === "External"
    result.set(id, {
      target: external ? target : resolvePartPath(partPath, target),
      type: attr(relationship, "Type") ?? "",
      external,
    })
  }
  return result
}

function parseColorElement(element: Element | undefined, themeColors: ThemeColors): Paint | undefined {
  if (!element) return undefined

  const srgb = child(element, "srgbClr")
  const scheme = child(element, "schemeClr")
  const preset = child(element, "prstClr")
  const system = child(element, "sysClr")

  let color: string | undefined
  let colorSource: Element | undefined
  if (srgb) {
    color = `#${(attr(srgb, "val") ?? "000000").replace(/^#/, "")}`
    colorSource = srgb
  } else if (scheme) {
    const key = attr(scheme, "val") ?? ""
    color = themeColors[key] ?? defaultThemeColors[key] ?? "#000000"
    colorSource = scheme
  } else if (preset) {
    const key = attr(preset, "val") ?? ""
    color = presetColors[key] ?? key
    colorSource = preset
  } else if (system) {
    color = `#${(attr(system, "lastClr") ?? attr(system, "val") ?? "000000").replace(/^#/, "")}`
    colorSource = system
  }

  if (!color) return undefined

  color = colorSource ? applyColorTransforms(color, colorSource) : color

  const alphaElement = colorSource ? child(colorSource, "alpha") : undefined
  const alpha = alphaElement ? Math.max(0, Math.min(1, numericAttr(alphaElement, "val", 100000) / 100000)) : 1
  return {
    color,
    opacity: alpha,
  }
}

function clampColorChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function parseHexColor(color: string): [number, number, number] | undefined {
  const value = color.replace(/^#/, "")
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return undefined
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ]
}

function formatHexColor([red, green, blue]: [number, number, number]): string {
  return `#${[red, green, blue].map((value) => clampColorChannel(value).toString(16).padStart(2, "0")).join("")}`
}

function cssColor(color: string, opacity = 1): string {
  const channels = parseHexColor(color)
  if (!channels) return color
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${Math.max(0, Math.min(1, opacity))})`
}

function shadowCss(shadow: ShadowEffect): string {
  return `${shadow.dx}px ${shadow.dy}px ${shadow.blur}px ${cssColor(shadow.color, shadow.opacity)}`
}

function applyColorTransforms(color: string, colorSource: Element): string {
  let channels = parseHexColor(color)
  if (!channels) return color

  for (const transform of children(colorSource)) {
    const value = numericAttr(transform, "val", 100000) / 100000
    if (transform.localName === "lumMod" || transform.localName === "shade") {
      channels = channels.map((channel) => channel * value) as [number, number, number]
    } else if (transform.localName === "lumOff") {
      channels = channels.map((channel) => channel + 255 * value) as [number, number, number]
    } else if (transform.localName === "tint") {
      channels = channels.map((channel) => channel + (255 - channel) * value) as [number, number, number]
    }
  }

  return formatHexColor(channels)
}

function parseFill(element: Element | undefined, themeColors: ThemeColors): Paint | undefined {
  if (!element) return undefined
  if (child(element, "noFill")) return undefined
  const solidFill = child(element, "solidFill")
  const solid = parseColorElement(solidFill, themeColors)
  if (solid) return solid

  const gradientFill = child(element, "gradFill")
  const gradientStops = children(child(gradientFill, "gsLst"), "gs")
    .map((stop) => {
      const paint = parseColorElement(stop, themeColors)
      if (!paint) return undefined
      return {
        offset: Math.max(0, Math.min(1, numericAttr(stop, "pos", 0) / 100000)),
        color: paint.color,
        opacity: paint.opacity,
      }
    })
    .filter((stop): stop is GradientStop => Boolean(stop))
    .sort((a, b) => a.offset - b.offset)

  if (gradientStops.length > 0) {
    const fallback = gradientStops[Math.floor(gradientStops.length / 2)] ?? gradientStops[0]
    return {
      color: fallback.color,
      opacity: fallback.opacity,
      gradient: {
        angle: numericAttr(child(gradientFill, "lin"), "ang", 5400000) / 60000,
        stops: gradientStops,
      },
    }
  }

  return undefined
}

function hasExplicitFill(element: Element | undefined): boolean {
  if (!element) return false
  return ["noFill", "solidFill", "gradFill", "blipFill", "pattFill"].some((name) => Boolean(child(element, name)))
}

function parseStylePaint(style: Element | undefined, refName: "fillRef" | "lnRef", themeColors: ThemeColors): Paint | undefined {
  return parseColorElement(child(style, refName), themeColors)
}

async function parseImageFill(
  zip: JSZip,
  element: Element | undefined,
  relationships: Map<string, Relationship>,
  imageSources: ImageSourceStore,
): Promise<ImageFill | undefined> {
  const blipFill = child(element, "blipFill")
  const relId = relAttr(firstDescendant(blipFill, "blip"))
  if (!relId) return undefined

  const relationship = relationships.get(relId)
  if (!relationship || relationship.external || !relationship.type.includes("/image")) return undefined

  const src = await loadImageSource(zip, relationship.target, imageSources)
  return src ? { src } : undefined
}

function dashArrayForPreset(value: string | undefined, width: number): string | undefined {
  if (!value || value === "solid") return undefined
  const unit = Math.max(1, width)
  const patterns: Record<string, number[]> = {
    dash: [4, 3],
    dashDot: [4, 3, 1, 3],
    dot: [1, 3],
    lgDash: [8, 3],
    lgDashDot: [8, 3, 1, 3],
    lgDashDotDot: [8, 3, 1, 3, 1, 3],
    sysDash: [3, 2],
    sysDashDot: [3, 2, 1, 2],
    sysDashDotDot: [3, 2, 1, 2, 1, 2],
    sysDot: [1, 2],
  }
  return patterns[value]?.map((item) => item * unit).join(" ")
}

function parseStroke(
  element: Element | undefined,
  themeColors: ThemeColors,
): { paint?: Paint; width: number; dash?: string } {
  const line = child(element, "ln")
  if (!line || child(line, "noFill")) return { width: 1 }
  const paint = parseFill(line, themeColors)
  if (!paint && children(line).length === 0 && !localAttr(line, "w")) return { width: 1 }
  const width = numericAttr(line, "w", 12700)
  const strokeWidth = Math.max(1, emuToPx(width))
  return {
    paint: paint ?? { color: "#6b7280", opacity: 1 },
    width: strokeWidth,
    dash: dashArrayForPreset(attr(child(line, "prstDash"), "val"), strokeWidth),
  }
}

function parseOuterShadow(element: Element | undefined, themeColors: ThemeColors): ShadowEffect | undefined {
  const shadow = firstDescendant(child(element, "effectLst"), "outerShdw")
  if (!shadow) return undefined

  const distance = emuToPx(numericAttr(shadow, "dist", 0))
  const angle = (numericAttr(shadow, "dir", 5400000) / 60000) * (Math.PI / 180)
  const paint = parseColorElement(shadow, themeColors) ?? { color: "#000000", opacity: 0.35 }

  return {
    dx: Math.cos(angle) * distance,
    dy: Math.sin(angle) * distance,
    blur: emuToPx(numericAttr(shadow, "blurRad", 0)),
    color: paint.color,
    opacity: paint.opacity,
  }
}

function parseGlow(element: Element | undefined, themeColors: ThemeColors): ShadowEffect | undefined {
  const glow = firstDescendant(child(element, "effectLst"), "glow")
  if (!glow) return undefined
  const paint = parseColorElement(glow, themeColors) ?? { color: "#ffffff", opacity: 1 }
  return {
    dx: 0,
    dy: 0,
    blur: emuToPx(numericAttr(glow, "rad", 0)),
    color: paint.color,
    opacity: paint.opacity,
  }
}

function parseTextShadow(
  runProperties: Element | undefined,
  defaultRunProperties: Element | undefined,
  themeColors: ThemeColors,
): string | undefined {
  const source =
    child(runProperties, "effectLst") || child(runProperties, "effectDag") ? runProperties : defaultRunProperties
  const effects = [parseGlow(source, themeColors), parseOuterShadow(source, themeColors)]
    .filter((effect): effect is ShadowEffect => Boolean(effect))
    .map(shadowCss)
  return effects.length > 0 ? effects.join(", ") : undefined
}

function parseSoftEdge(element: Element | undefined): number | undefined {
  const softEdge = firstDescendant(child(element, "effectLst"), "softEdge")
  if (!softEdge) return undefined
  const radius = emuToPx(numericAttr(softEdge, "rad", 0))
  return radius > 0 ? radius : undefined
}

function parseImageOpacity(blip: Element | undefined): number {
  if (!blip) return 1

  let opacity = 1
  for (const alpha of [...children(blip, "alpha"), ...children(blip, "alphaMod"), ...children(blip, "alphaModFix")]) {
    const value = numericAttr(alpha, "val", numericAttr(alpha, "amt", 100000)) / 100000
    opacity *= Math.max(0, Math.min(1, value))
  }
  return opacity
}

function parseImageCrop(blipFill: Element | undefined): ImageCrop | undefined {
  const sourceRect = child(blipFill, "srcRect")
  if (!sourceRect || children(sourceRect).length === 0 && sourceRect.attributes.length === 0) return undefined

  const crop = {
    left: Math.max(0, Math.min(1, numericAttr(sourceRect, "l", 0) / 100000)),
    top: Math.max(0, Math.min(1, numericAttr(sourceRect, "t", 0) / 100000)),
    right: Math.max(0, Math.min(1, numericAttr(sourceRect, "r", 0) / 100000)),
    bottom: Math.max(0, Math.min(1, numericAttr(sourceRect, "b", 0) / 100000)),
  }
  return crop.left || crop.top || crop.right || crop.bottom ? crop : undefined
}

function parseTransform(element: Element | undefined, context: TransformContext): Transform | undefined {
  const xfrm = child(element, "xfrm") ?? firstDescendant(element, "xfrm")
  if (!xfrm) return undefined
  const off = child(xfrm, "off")
  const ext = child(xfrm, "ext")
  if (!off || !ext) return undefined

  const x = emuToPx(numericAttr(off, "x"))
  const y = emuToPx(numericAttr(off, "y"))
  const width = emuToPx(numericAttr(ext, "cx"))
  const height = emuToPx(numericAttr(ext, "cy"))
  const rotationValue = localAttr(xfrm, "rot")
  const rotation = rotationValue ? Number(rotationValue) / 60000 : undefined

  return {
    x: context.x + x * context.scaleX,
    y: context.y + y * context.scaleY,
    width: width * context.scaleX,
    height: height * context.scaleY,
    rotation,
  }
}

function parsePresetAdjustments(presetGeometry: Element | undefined): Record<string, number> | undefined {
  const adjustments: Record<string, number> = {}
  for (const guide of children(child(presetGeometry, "avLst"), "gd")) {
    const name = attr(guide, "name")
    const formula = attr(guide, "fmla")
    const match = formula?.match(/^val\s+(-?\d+(?:\.\d+)?)$/)
    if (!name || !match) continue
    const value = Number(match[1])
    if (Number.isFinite(value)) adjustments[name] = value
  }
  return Object.keys(adjustments).length > 0 ? adjustments : undefined
}

function customGeometryPoint(point: Element, transform: Transform, pathWidth: number, pathHeight: number): [number, number] {
  const x = transform.x + transform.width * (numericAttr(point, "x") / pathWidth)
  const y = transform.y + transform.height * (numericAttr(point, "y") / pathHeight)
  return [x, y]
}

function parseCustomGeometryPath(element: Element | undefined, transform: Transform): string | undefined {
  const pathList = child(element, "pathLst")
  const commands: string[] = []

  for (const path of children(pathList, "path")) {
    const pathWidth = numericAttr(path, "w", 0)
    const pathHeight = numericAttr(path, "h", 0)
    if (pathWidth <= 0 || pathHeight <= 0) continue

    for (const command of children(path)) {
      if (command.localName === "close") {
        commands.push("Z")
        continue
      }

      const points = children(command, "pt").map((point) => customGeometryPoint(point, transform, pathWidth, pathHeight))
      if (points.length === 0) continue

      if (command.localName === "moveTo") {
        commands.push(`M ${points[0][0]} ${points[0][1]}`)
      } else if (command.localName === "lnTo") {
        commands.push(`L ${points[0][0]} ${points[0][1]}`)
      } else if (command.localName === "cubicBezTo" && points.length >= 3) {
        commands.push(
          `C ${points[0][0]} ${points[0][1]}, ${points[1][0]} ${points[1][1]}, ${points[2][0]} ${points[2][1]}`,
        )
      } else if (command.localName === "quadBezTo" && points.length >= 2) {
        commands.push(`Q ${points[0][0]} ${points[0][1]}, ${points[1][0]} ${points[1][1]}`)
      }
    }
  }

  return commands.length > 0 ? commands.join(" ") : undefined
}

function parseCustomGeometryPoints(element: Element | undefined, transform: Transform): [number, number][] | undefined {
  const path = child(child(element, "pathLst"), "path")
  if (!path) return undefined
  const pathWidth = numericAttr(path, "w", 0)
  const pathHeight = numericAttr(path, "h", 0)
  if (pathWidth <= 0 || pathHeight <= 0) return undefined

  const points = descendants(path, "pt").map((point) => customGeometryPoint(point, transform, pathWidth, pathHeight))

  return points.length >= 3 ? points : undefined
}

function parseGroupContext(element: Element, context: TransformContext): TransformContext {
  const xfrm = firstDescendant(child(element, "grpSpPr"), "xfrm")
  if (!xfrm) return context

  const off = child(xfrm, "off")
  const ext = child(xfrm, "ext")
  const chOff = child(xfrm, "chOff")
  const chExt = child(xfrm, "chExt")
  if (!off || !ext || !chOff || !chExt) return context

  const groupX = emuToPx(numericAttr(off, "x"))
  const groupY = emuToPx(numericAttr(off, "y"))
  const childX = emuToPx(numericAttr(chOff, "x"))
  const childY = emuToPx(numericAttr(chOff, "y"))
  const groupWidth = emuToPx(numericAttr(ext, "cx", 1))
  const groupHeight = emuToPx(numericAttr(ext, "cy", 1))
  const childWidth = emuToPx(numericAttr(chExt, "cx", 1))
  const childHeight = emuToPx(numericAttr(chExt, "cy", 1))
  const scaleX = groupWidth / Math.max(1, childWidth)
  const scaleY = groupHeight / Math.max(1, childHeight)

  return {
    x: context.x + (groupX - childX * scaleX) * context.scaleX,
    y: context.y + (groupY - childY * scaleY) * context.scaleY,
    scaleX: context.scaleX * scaleX,
    scaleY: context.scaleY * scaleY,
  }
}

function placeholderForShape(element: Element): PlaceholderKey | undefined {
  if (element.localName !== "sp") return undefined
  const placeholder = firstDescendant(child(element, "nvSpPr"), "ph")
  if (!placeholder) return undefined
  return {
    type: attr(placeholder, "type") ?? "body",
    idx: attr(placeholder, "idx"),
  }
}

function placeholderLookupKeys(placeholder: PlaceholderKey): string[] {
  const keys: string[] = []
  if (placeholder.idx) keys.push(`idx:${placeholder.idx}`)
  if (placeholder.type) keys.push(`type:${placeholder.type}`)
  return keys
}

function collectPlaceholderDefinitions(
  element: Element | Document | undefined,
  placeholders: Map<string, PlaceholderDefinition>,
) {
  for (const item of children(element)) {
    if (item.localName === "sp") {
      const placeholder = placeholderForShape(item)
      if (placeholder) {
        for (const key of placeholderLookupKeys(placeholder)) {
          placeholders.set(key, { element: item })
        }
      }
    } else if (item.localName === "grpSp") {
      collectPlaceholderDefinitions(item, placeholders)
    }
  }
}

function placeholderDefinitionFor(
  placeholder: PlaceholderKey | undefined,
  placeholders: Map<string, PlaceholderDefinition> | undefined,
): PlaceholderDefinition | undefined {
  if (!placeholder || !placeholders) return undefined
  for (const key of placeholderLookupKeys(placeholder)) {
    const definition = placeholders.get(key)
    if (definition) return definition
  }
  return undefined
}

function parseThemeColors(themeXml: string | undefined): ThemeColors {
  const colors: ThemeColors = { ...defaultThemeColors }
  if (!themeXml) return colors

  const doc = parseXml(themeXml)
  const scheme = firstDescendant(doc, "clrScheme")
  if (!scheme) return colors

  for (const entry of children(scheme)) {
    const color = parseColorElement(entry, colors)
    if (color) colors[entry.localName] = color.color
  }

  colors.tx1 = colors.dk1
  colors.bg1 = colors.lt1
  colors.tx2 = colors.dk2
  colors.bg2 = colors.lt2
  return colors
}

function paragraphAlign(value: string | undefined): TextParagraph["align"] {
  if (value === "ctr") return "center"
  if (value === "r") return "right"
  if (value === "just") return "justify"
  return "left"
}

function boolAttr(
  element: Element | undefined,
  fallbackElement: Element | undefined,
  name: string,
): boolean | undefined {
  const value = localAttr(element, name) ?? localAttr(fallbackElement, name)
  if (value === undefined) return undefined
  return value === "1" || value === "true"
}

function parseParagraphLineHeight(paragraphProperties: Array<Element | undefined>, fontSize: number): number {
  const lineSpacing = paragraphProperties.map((item) => child(item, "lnSpc")).find(Boolean)
  const percentage = child(lineSpacing, "spcPct")
  if (percentage) return Math.max(0.8, numericAttr(percentage, "val", 100000) / 100000)
  const points = child(lineSpacing, "spcPts")
  if (points) {
    const lineHeightPx = (numericAttr(points, "val", 0) / 100) * (96 / 72)
    return Math.max(0.8, lineHeightPx / Math.max(1, fontSize))
  }
  return 1.18
}

function parseParagraphMarginLeft(paragraphProperties: Array<Element | undefined>): number | undefined {
  const source = paragraphProperties.find((item) => localAttr(item, "marL") !== undefined)
  if (!source) return undefined
  const margin = emuToPx(numericAttr(source, "marL", 0))
  return margin > 0 ? margin : undefined
}

function paragraphLevelProperties(textBody: Element | undefined, paragraphProperties: Element | undefined): Element | undefined {
  const listStyle = child(textBody, "lstStyle")
  if (!listStyle) return undefined
  const level = Math.max(0, Math.min(8, numericAttr(paragraphProperties, "lvl", 0)))
  return child(listStyle, `lvl${level + 1}pPr`) ?? child(listStyle, "defPPr")
}

function normalizeBulletCharacter(character: string, font: string | undefined): string {
  if (!font?.toLowerCase().includes("wingdings")) return character
  const wingdingsMap: Record<string, string> = {
    l: "●",
    n: "▪",
    u: "◆",
  }
  return wingdingsMap[character] ?? character
}

function parseBulletCharacter(paragraphProperties: Element | undefined): string | undefined {
  const bullet = child(paragraphProperties, "buChar")
  const character = attr(bullet, "char")
  if (!character) return undefined
  return normalizeBulletCharacter(character, attr(child(paragraphProperties, "buFont"), "typeface"))
}

function parseFontScale(bodyProperties: Element | undefined, inheritedBodyProperties: Element | undefined): number {
  const autofit = child(bodyProperties, "normAutofit") ?? child(inheritedBodyProperties, "normAutofit")
  if (!autofit) return 1
  return Math.max(0.2, Math.min(2, numericAttr(autofit, "fontScale", 100000) / 100000))
}

function parseAutoFit(bodyProperties: Element | undefined): TextBlock["autoFit"] {
  if (child(bodyProperties, "spAutoFit")) return "shape"
  if (child(bodyProperties, "normAutofit")) return "font"
  return undefined
}

function parseRun(
  run: Element,
  defaultRunProperties: Element | undefined,
  themeColors: ThemeColors,
  defaultSize = 18,
  fontScale = 1,
): TextRun | undefined {
  const text = descendants(run, "t")
    .map((node) => node.textContent ?? "")
    .join("")
  if (!text) return undefined

  const runProperties = child(run, "rPr")
  const fontSize = numericAttr(runProperties, "sz", numericAttr(defaultRunProperties, "sz", defaultSize * 100)) / 100
  const color = parseFill(runProperties, themeColors) ?? parseFill(defaultRunProperties, themeColors)
  const latin = child(runProperties, "latin") ?? child(defaultRunProperties, "latin")
  const eastAsian = child(runProperties, "ea") ?? child(defaultRunProperties, "ea")
  const underline = localAttr(runProperties, "u") ?? localAttr(defaultRunProperties, "u")

  return {
    text,
    bold: boolAttr(runProperties, defaultRunProperties, "b"),
    italic: boolAttr(runProperties, defaultRunProperties, "i"),
    underline: underline !== undefined && underline !== "none",
    color: color?.color,
    fontSize: fontSize * (96 / 72) * fontScale,
    fontFamily: attr(eastAsian, "typeface") ?? attr(latin, "typeface"),
    shadow: parseTextShadow(runProperties, defaultRunProperties, themeColors),
  }
}

function inheritedTextDefaults(
  inheritedTextBody: Element | undefined,
  paragraphIndex: number,
  paragraphProperties: Element | undefined,
): Element | undefined {
  const inheritedParagraph = inheritedTextBody ? children(inheritedTextBody, "p")[paragraphIndex] : undefined
  const inheritedParagraphProperties = child(inheritedParagraph, "pPr")
  const inheritedLevelProperties = paragraphLevelProperties(
    inheritedTextBody,
    paragraphProperties ?? inheritedParagraphProperties,
  )
  return (
    child(inheritedParagraphProperties, "defRPr") ??
    child(inheritedLevelProperties, "defRPr") ??
    firstDescendant(child(inheritedTextBody, "lstStyle"), "defRPr")
  )
}

function parseTextBody(
  textBody: Element | undefined,
  themeColors: ThemeColors,
  inheritedTextBody?: Element,
): TextBlock | undefined {
  if (!textBody) return undefined

  const bodyProperties = child(textBody, "bodyPr")
  const inheritedBodyProperties = child(inheritedTextBody, "bodyPr")
  const inset = {
    top: emuToPx(numericAttr(bodyProperties, "tIns", numericAttr(inheritedBodyProperties, "tIns", 45720))),
    right: emuToPx(numericAttr(bodyProperties, "rIns", numericAttr(inheritedBodyProperties, "rIns", 91440))),
    bottom: emuToPx(numericAttr(bodyProperties, "bIns", numericAttr(inheritedBodyProperties, "bIns", 45720))),
    left: emuToPx(numericAttr(bodyProperties, "lIns", numericAttr(inheritedBodyProperties, "lIns", 91440))),
  }
  const anchor = attr(bodyProperties, "anchor") ?? attr(inheritedBodyProperties, "anchor")
  const verticalAlign = anchor === "ctr" ? "center" : anchor === "b" ? "flex-end" : "flex-start"
  const fontScale = parseFontScale(bodyProperties, inheritedBodyProperties)
  const wrap = attr(bodyProperties, "wrap") ?? attr(inheritedBodyProperties, "wrap")
  const ownAutoFit = parseAutoFit(bodyProperties)
  const inheritedAutoFit = parseAutoFit(inheritedBodyProperties)
  const noWrap = wrap === "none"

  const paragraphs: TextParagraph[] = []
  for (const [paragraphIndex, paragraph] of children(textBody, "p").entries()) {
    const paragraphProperties = child(paragraph, "pPr")
    const localLevelProperties = paragraphLevelProperties(textBody, paragraphProperties)
    const inheritedParagraph = inheritedTextBody ? children(inheritedTextBody, "p")[paragraphIndex] : undefined
    const inheritedParagraphProperties = child(inheritedParagraph, "pPr")
    const inheritedLevelProperties = paragraphLevelProperties(
      inheritedTextBody,
      paragraphProperties ?? inheritedParagraphProperties,
    )
    const paragraphPropertySources = [
      paragraphProperties,
      localLevelProperties,
      inheritedParagraphProperties,
      inheritedLevelProperties,
    ]
    const defaultRunProperties =
      child(paragraphProperties, "defRPr") ??
      child(localLevelProperties, "defRPr") ??
      inheritedTextDefaults(inheritedTextBody, paragraphIndex, paragraphProperties)
    const runs: TextRun[] = []

    for (const item of children(paragraph)) {
      if (item.localName === "r" || item.localName === "fld") {
        const parsed = parseRun(item, defaultRunProperties, themeColors, 18, fontScale)
        if (parsed) runs.push(parsed)
      } else if (item.localName === "br") {
        runs.push({ text: "\n", fontSize: 18 * (96 / 72) * fontScale })
      }
    }

    const hasVisibleRuns = runs.length > 0
    if (!hasVisibleRuns) {
      const emptyRunProperties = child(paragraph, "endParaRPr") ?? defaultRunProperties
      const fontSize = numericAttr(emptyRunProperties, "sz", numericAttr(defaultRunProperties, "sz", 18 * 100)) / 100
      runs.push({
        text: "\u00a0",
        fontSize: fontSize * (96 / 72) * fontScale,
        fontFamily:
          attr(child(emptyRunProperties, "ea") ?? child(defaultRunProperties, "ea"), "typeface") ??
          attr(child(emptyRunProperties, "latin") ?? child(defaultRunProperties, "latin"), "typeface"),
      })
    }

    const bulletCharacter =
      parseBulletCharacter(paragraphProperties) ??
      parseBulletCharacter(localLevelProperties) ??
      parseBulletCharacter(inheritedParagraphProperties) ??
      parseBulletCharacter(inheritedLevelProperties)
    const hasAutoNumber = Boolean(
      child(paragraphProperties, "buAutoNum") ??
        child(localLevelProperties, "buAutoNum") ??
        child(inheritedParagraphProperties, "buAutoNum") ??
        child(inheritedLevelProperties, "buAutoNum"),
    )

    paragraphs.push({
      runs,
      align: paragraphAlign(
        attr(paragraphProperties, "algn") ??
          attr(localLevelProperties, "algn") ??
          attr(inheritedParagraphProperties, "algn") ??
          attr(inheritedLevelProperties, "algn"),
      ),
      bullet: hasVisibleRuns ? (bulletCharacter ?? (hasAutoNumber ? "1." : undefined)) : undefined,
      lineHeight: parseParagraphLineHeight(
        paragraphPropertySources,
        Math.max(...runs.map((run) => run.fontSize), 12),
      ),
      marginLeft: parseParagraphMarginLeft(paragraphPropertySources),
    })
  }

  if (paragraphs.length === 0) return undefined
  return {
    paragraphs,
    inset,
    verticalAlign,
    autoFit: ownAutoFit ?? inheritedAutoFit,
    noWrap,
  }
}

function applyTableCellTextProperties(text: TextBlock | undefined, cellProperties: Element | undefined): TextBlock | undefined {
  if (!text) return undefined
  const anchor = attr(cellProperties, "anchor")
  return {
    ...text,
    inset: {
      top:
        localAttr(cellProperties, "marT") !== undefined
          ? emuToPx(numericAttr(cellProperties, "marT", 0))
          : text.inset.top,
      right:
        localAttr(cellProperties, "marR") !== undefined
          ? emuToPx(numericAttr(cellProperties, "marR", 0))
          : text.inset.right,
      bottom:
        localAttr(cellProperties, "marB") !== undefined
          ? emuToPx(numericAttr(cellProperties, "marB", 0))
          : text.inset.bottom,
      left:
        localAttr(cellProperties, "marL") !== undefined
          ? emuToPx(numericAttr(cellProperties, "marL", 0))
          : text.inset.left,
    },
    verticalAlign: anchor === "ctr" ? "center" : anchor === "b" ? "flex-end" : text.verticalAlign,
  }
}

function textPreview(text?: TextBlock): string {
  if (!text) return ""
  return text.paragraphs
    .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

function elementCenter(element: BaseElement): { x: number; y: number } {
  return {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  }
}

function rotationTransform(element: BaseElement): string | undefined {
  if (!element.rotation) return undefined
  const center = elementCenter(element)
  return `rotate(${element.rotation} ${center.x} ${center.y})`
}

function svgPoints(points: Array<[number, number]>): string {
  return points.map(([x, y]) => `${x},${y}`).join(" ")
}

function arcPoint(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  const radians = ((angle - 90) * Math.PI) / 180
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  }
}

function pieSlicePath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
  const start = arcPoint(cx, cy, radius, endAngle)
  const end = arcPoint(cx, cy, radius, startAngle)
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y} Z`
}

function formatChartNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toFixed(1)))
}

function finiteOrUndefined(value: number): number | undefined {
  return Number.isFinite(value) ? value : undefined
}

function chartTitleText(element: Element | undefined): string | undefined {
  if (!element) return undefined

  const richText = descendants(element, "t")
    .map((node) => node.textContent ?? "")
    .join("")
    .trim()
  if (richText) return richText

  return (
    descendants(element, "v")
      .map((node) => node.textContent?.trim() ?? "")
      .find(Boolean) || undefined
  )
}

function niceAxisStep(maxValue: number): number {
  if (maxValue <= 0) return 1
  const targetStep = maxValue / 6
  const magnitude = 10 ** Math.floor(Math.log10(targetStep))
  const normalized = targetStep / magnitude

  if (normalized <= 1) return magnitude
  if (normalized <= 2) return 2 * magnitude
  if (normalized <= 5) return 5 * magnitude
  return 10 * magnitude
}

function buildAxisTicks(min: number, max: number, majorUnit: number): number[] {
  const ticks: number[] = []
  const start = Math.ceil(min / majorUnit) * majorUnit
  for (let value = start; value <= max + majorUnit * 0.001; value += majorUnit) {
    ticks.push(Number(value.toFixed(8)))
  }
  if (ticks.length === 0 || ticks[0] > min) ticks.unshift(min)
  if (ticks[ticks.length - 1] < max) ticks.push(max)
  return ticks
}

function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0
  for (const char of text) {
    if (char === " ") width += fontSize * 0.33
    // eslint-disable-next-line no-control-regex -- ASCII/半角字符范围判定，用于中英文混排的宽度估算
    else if (/[\u0000-\u00ff]/.test(char)) width += fontSize * 0.56
    else width += fontSize
  }
  return width
}

function estimateTextBlockHeight(text: TextBlock, element: BaseElement): number {
  let height = text.inset.top + text.inset.bottom

  for (const paragraph of text.paragraphs) {
    const fontSize = Math.max(...paragraph.runs.map((run) => run.fontSize), 12)
    const availableWidth = Math.max(1, element.width - text.inset.left - text.inset.right - (paragraph.marginLeft ?? 0))
    const textWidth = paragraph.runs.reduce((sum, run) => sum + estimateTextWidth(run.text, run.fontSize), 0)
    const lineCount = text.noWrap ? 1 : Math.max(1, Math.ceil(textWidth / availableWidth))
    height += lineCount * fontSize * paragraph.lineHeight
  }

  return Math.max(element.height, height)
}

function renderTextBlock(text: TextBlock | undefined, element: BaseElement, options: TextRenderOptions = {}) {
  if (!text) return null
  const width = Math.max(1, element.width)
  const height = Math.max(1, element.height)
  const estimatedHeight = estimateTextBlockHeight(text, element)
  const expandHeight = options.expandHeight ?? text.autoFit === "shape"
  const renderHeight = expandHeight ? estimatedHeight : height
  const overflow = expandHeight ? "visible" : "hidden"
  const justifyContent = estimatedHeight > height + 1 ? "flex-start" : text.verticalAlign

  return (
    <foreignObject
      x={element.x}
      y={element.y}
      width={width}
      height={renderHeight}
      overflow={overflow}
      pointer-events="none"
    >
      <div
        style={{
          width: `${width}px`,
          height: `${renderHeight}px`,
          display: "flex",
          "box-sizing": "border-box",
          "flex-direction": "column",
          "justify-content": justifyContent,
          overflow,
          padding: `${text.inset.top}px ${text.inset.right}px ${text.inset.bottom}px ${text.inset.left}px`,
          "font-family": '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
          "line-height": "1.18",
          color: "#111827",
        }}
      >
        <For each={text.paragraphs}>
          {(paragraph) => (
            <div
              style={{
                "text-align": paragraph.align,
                "white-space": text.noWrap ? "pre" : "pre-wrap",
                "overflow-wrap": text.noWrap ? "normal" : "break-word",
                "line-height": String(paragraph.lineHeight),
                "box-sizing": "border-box",
                "padding-left": paragraph.marginLeft ? `${paragraph.marginLeft}px` : undefined,
                margin: "0",
              }}
            >
              <Show when={paragraph.bullet}>
                {(bullet) => (
                  <span
                    style={{
                      "font-size": `${paragraph.runs[0]?.fontSize ?? 24}px`,
                      "margin-right": "0.35em",
                    }}
                  >
                    {bullet()}{" "}
                  </span>
                )}
              </Show>
              <For each={paragraph.runs}>
                {(run) => (
                  <span
                    style={{
                      "font-size": `${run.fontSize}px`,
                      "font-family": run.fontFamily ?? "inherit",
                      "font-weight": run.bold ? "700" : "400",
                      "font-style": run.italic ? "italic" : "normal",
                      "text-decoration": run.underline ? "underline" : "none",
                      color: run.color ?? "inherit",
                      "text-shadow": run.shadow,
                    }}
                  >
                    {run.text}
                  </span>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </foreignObject>
  )
}

const SlideChart: Component<{ element: ChartElement }> = (props) => {
  const colorFor = (point: ChartPoint, index: number) =>
    point.color ?? props.element.colors[index] ?? chartPalette[index % chartPalette.length]
  const total = () => props.element.points.reduce((sum, point) => sum + Math.max(0, point.value), 0)

  const pieChart = () => {
    const item = props.element
    const totalValue = total()
    if (totalValue <= 0) return null

    const radius = Math.min(item.width * 0.27, item.height * 0.42)
    const cx = item.x + item.width * 0.34
    const cy = item.y + item.height * 0.52
    const legendX = item.x + item.width * 0.64
    const legendY = item.y + item.height * 0.22
    let currentAngle = 0

    return (
      <g transform={rotationTransform(item)}>
        <For each={item.points}>
          {(point, index) => {
            const startAngle = currentAngle
            const endAngle = startAngle + (Math.max(0, point.value) / totalValue) * 360
            const midAngle = (startAngle + endAngle) / 2
            const labelPoint = arcPoint(cx, cy, radius * 0.72, midAngle)
            currentAngle = endAngle
            return (
              <g>
                <path
                  d={pieSlicePath(cx, cy, radius, startAngle, endAngle)}
                  fill={colorFor(point, index())}
                  stroke="#ffffff"
                  stroke-width="1"
                />
                <Show when={endAngle - startAngle >= 18}>
                  <text
                    x={labelPoint.x}
                    y={labelPoint.y}
                    fill="#111827"
                    font-size="12"
                    font-weight="600"
                    text-anchor="middle"
                    dominant-baseline="middle"
                  >
                    {Math.round((point.value / totalValue) * 100)}%
                  </text>
                </Show>
              </g>
            )
          }}
        </For>
        <For each={item.points}>
          {(point, index) => (
            <g transform={`translate(${legendX}, ${legendY + index() * 20})`}>
              <rect width="8" height="8" y="-7" fill={colorFor(point, index())} />
              <text x="13" y="0" fill="#1f2937" font-size="12">
                {point.label}
              </text>
            </g>
          )}
        </For>
      </g>
    )
  }

  const barChart = () => {
    const item = props.element
    const values = item.points.map((point) => Math.max(0, point.value))
    const dataMax = Math.max(...values, 1)
    const axisMin = Math.min(0, item.axisMin ?? 0)
    const majorUnit = item.axisMajorUnit && item.axisMajorUnit > 0 ? item.axisMajorUnit : niceAxisStep(dataMax)
    const axisMax = Math.max(item.axisMax ?? Math.ceil(dataMax / majorUnit) * majorUnit, dataMax, majorUnit)
    const ticks = buildAxisTicks(axisMin, axisMax, majorUnit)
    const left = item.x + item.width * (item.yAxisTitle ? 0.16 : 0.12)
    const right = item.x + item.width * 0.96
    const top = item.y + item.height * (item.title ? 0.18 : 0.13)
    const bottom = item.y + item.height * (item.xAxisTitle ? 0.76 : 0.81)
    const plotWidth = Math.max(1, right - left)
    const plotHeight = Math.max(1, bottom - top)
    const step = plotWidth / Math.max(1, item.points.length)
    const barWidth = Math.max(8, step * 0.58)
    const yForValue = (value: number) => bottom - ((value - axisMin) / Math.max(1, axisMax - axisMin)) * plotHeight

    return (
      <g transform={rotationTransform(item)}>
        <Show when={item.showGridLines}>
          <For each={ticks}>
            {(tick) => {
              const y = yForValue(tick)
              return (
                <line x1={left} y1={y} x2={right} y2={y} stroke="#9ca3af" stroke-width="0.8" stroke-opacity="0.8" />
              )
            }}
          </For>
        </Show>
        <line x1={left} y1={bottom} x2={right} y2={bottom} stroke="#9ca3af" stroke-width="1" />
        <line x1={left} y1={top} x2={left} y2={bottom} stroke="#9ca3af" stroke-width="1" />
        <For each={ticks}>
          {(tick) => {
            const y = yForValue(tick)
            return (
              <g>
                <line x1={left - 3} y1={y} x2={left} y2={y} stroke="#9ca3af" stroke-width="1" />
                <text x={left - 7} y={y + 3.5} fill="#374151" font-size="10" text-anchor="end">
                  {formatChartNumber(tick)}
                </text>
              </g>
            )
          }}
        </For>
        <Show when={item.yAxisTitle}>
          {(title) => {
            const x = item.x + item.width * 0.045
            const y = top + plotHeight / 2
            return (
              <text x={x} y={y} fill="#374151" font-size="11" text-anchor="middle" transform={`rotate(-90 ${x} ${y})`}>
                {title()}
              </text>
            )
          }}
        </Show>
        <For each={item.points}>
          {(point, index) => {
            const value = Math.max(axisMin, point.value)
            const y = yForValue(value)
            const barHeight = Math.max(0, bottom - y)
            const x = left + index() * step + (step - barWidth) / 2
            return (
              <g>
                <rect x={x} y={y} width={barWidth} height={barHeight} fill={colorFor(point, index())} rx="2" />
                <text x={x + barWidth / 2} y={y - 5} fill="#374151" font-size="10" text-anchor="middle">
                  {formatChartNumber(point.value)}
                </text>
                <text x={x + barWidth / 2} y={bottom + 15} fill="#4b5563" font-size="10" text-anchor="middle">
                  {point.label}
                </text>
              </g>
            )
          }}
        </For>
        <Show when={item.title}>
          <text x={item.x + item.width / 2} y={item.y + 14} fill="#374151" font-size="12" text-anchor="middle">
            {item.title}
          </text>
        </Show>
        <Show when={item.xAxisTitle}>
          {(title) => (
            <text x={left + plotWidth / 2} y={bottom + 34} fill="#374151" font-size="11" text-anchor="middle">
              {title()}
            </text>
          )}
        </Show>
      </g>
    )
  }

  return props.element.chartType === "pie" ? pieChart() : barChart()
}

function paintAttrs(paint: Paint | undefined, fallback = "none") {
  return {
    color: paint?.color ?? fallback,
    opacity: paint?.opacity ?? 1,
  }
}

function doubleWavePath(item: BaseElement): string {
  const top = item.y + item.height * 0.16
  const bottom = item.y + item.height * 0.78
  const amplitude = item.height * 0.12
  const x0 = item.x
  const x1 = item.x + item.width
  const mid = item.x + item.width / 2

  return [
    `M ${x0} ${top}`,
    `C ${item.x + item.width * 0.18} ${top + amplitude}, ${item.x + item.width * 0.32} ${top + amplitude}, ${mid} ${top}`,
    `C ${item.x + item.width * 0.68} ${top - amplitude}, ${item.x + item.width * 0.82} ${top - amplitude}, ${x1} ${top}`,
    `L ${x1} ${bottom}`,
    `C ${item.x + item.width * 0.82} ${bottom + amplitude}, ${item.x + item.width * 0.68} ${bottom + amplitude}, ${mid} ${bottom}`,
    `C ${item.x + item.width * 0.32} ${bottom - amplitude}, ${item.x + item.width * 0.18} ${bottom - amplitude}, ${x0} ${bottom}`,
    "Z",
  ].join(" ")
}

function wavePath(item: BaseElement): string {
  const top = item.y + item.height * 0.22
  const amplitude = item.height * 0.15
  return [
    `M ${item.x} ${top}`,
    `C ${item.x + item.width * 0.25} ${top + amplitude}, ${item.x + item.width * 0.25} ${top + amplitude}, ${item.x + item.width * 0.5} ${top}`,
    `C ${item.x + item.width * 0.75} ${top - amplitude}, ${item.x + item.width * 0.75} ${top - amplitude}, ${item.x + item.width} ${top}`,
    `L ${item.x + item.width} ${item.y + item.height}`,
    `L ${item.x} ${item.y + item.height}`,
    "Z",
  ].join(" ")
}

function adjustmentRadius(item: ShapeElement, name: string, fallback: number): number {
  const value = Math.max(0, Math.min(50000, item.adjustments?.[name] ?? fallback))
  return Math.min(item.width, item.height) * (value / 100000)
}

function round2SameRectPath(item: ShapeElement): string {
  const topRadius = adjustmentRadius(item, "adj1", 16667)
  const bottomRadius = adjustmentRadius(item, "adj2", 0)
  const x0 = item.x
  const y0 = item.y
  const x1 = item.x + item.width
  const y1 = item.y + item.height

  return [
    `M ${x0 + topRadius} ${y0}`,
    `L ${x1 - topRadius} ${y0}`,
    topRadius > 0 ? `A ${topRadius} ${topRadius} 0 0 1 ${x1} ${y0 + topRadius}` : `L ${x1} ${y0}`,
    `L ${x1} ${y1 - bottomRadius}`,
    bottomRadius > 0 ? `A ${bottomRadius} ${bottomRadius} 0 0 1 ${x1 - bottomRadius} ${y1}` : `L ${x1} ${y1}`,
    `L ${x0 + bottomRadius} ${y1}`,
    bottomRadius > 0 ? `A ${bottomRadius} ${bottomRadius} 0 0 1 ${x0} ${y1 - bottomRadius}` : `L ${x0} ${y1}`,
    `L ${x0} ${y0 + topRadius}`,
    topRadius > 0 ? `A ${topRadius} ${topRadius} 0 0 1 ${x0 + topRadius} ${y0}` : `L ${x0} ${y0}`,
    "Z",
  ].join(" ")
}

const SlideShape: Component<{ element: ShapeElement }> = (props) => {
  const gradientId = createUniqueId()
  const clipId = createUniqueId()
  const shadowId = createUniqueId()
  const element = () => props.element
  const fillPaint = () => element().fill
  const fill = () => paintAttrs(element().fill)
  const stroke = () => paintAttrs(element().stroke)
  const expandTextHeight = () => {
    const item = element()
    return item.text?.autoFit === "shape" || (!item.fill && !item.imageFill && !item.stroke)
  }
  const transform = () => rotationTransform(element())
  const gradientVector = (angle: number) => {
    const radians = (angle * Math.PI) / 180
    const dx = Math.cos(radians)
    const dy = Math.sin(radians)
    return {
      x1: 0.5 - dx / 2,
      y1: 0.5 - dy / 2,
      x2: 0.5 + dx / 2,
      y2: 0.5 + dy / 2,
    }
  }

  const geometryNode = (attrs: Record<string, string | number>) => {
    const item = element()
    if (item.customPath) {
      return <path d={item.customPath} {...attrs} />
    }
    if (item.customPoints?.length) {
      return <polygon points={svgPoints(item.customPoints)} {...attrs} />
    }
    if (item.shape === "round2SameRect") {
      return <path d={round2SameRectPath(item)} {...attrs} />
    }
    if (item.shape === "doubleWave") {
      return <path d={doubleWavePath(item)} {...attrs} />
    }
    if (item.shape === "wave") {
      return <path d={wavePath(item)} {...attrs} />
    }
    if (item.shape === "ellipse" || item.shape === "flowChartConnector") {
      return (
        <ellipse
          cx={item.x + item.width / 2}
          cy={item.y + item.height / 2}
          rx={item.width / 2}
          ry={item.height / 2}
          {...attrs}
        />
      )
    }
    if (item.shape === "triangle") {
      return (
        <polygon
          points={svgPoints([
            [item.x + item.width / 2, item.y],
            [item.x + item.width, item.y + item.height],
            [item.x, item.y + item.height],
          ])}
          {...attrs}
        />
      )
    }
    if (item.shape === "diamond") {
      return (
        <polygon
          points={svgPoints([
            [item.x + item.width / 2, item.y],
            [item.x + item.width, item.y + item.height / 2],
            [item.x + item.width / 2, item.y + item.height],
            [item.x, item.y + item.height / 2],
          ])}
          {...attrs}
        />
      )
    }
    if (item.shape === "parallelogram") {
      const skew = item.width * 0.18
      return (
        <polygon
          points={svgPoints([
            [item.x + skew, item.y],
            [item.x + item.width, item.y],
            [item.x + item.width - skew, item.y + item.height],
            [item.x, item.y + item.height],
          ])}
          {...attrs}
        />
      )
    }
    return (
      <rect
        x={item.x}
        y={item.y}
        width={item.width}
        height={item.height}
        rx={item.shape === "roundRect" ? Math.min(item.width, item.height) * 0.18 : 0}
        ry={item.shape === "roundRect" ? Math.min(item.width, item.height) * 0.18 : 0}
        {...attrs}
      />
    )
  }

  const shapeNode = () => {
    const item = element()
    const gradient = fillPaint()?.gradient
    const fillValue = fill()
    const strokeValue = stroke()
    const common: Record<string, string | number> = {
      fill: gradient ? `url(#${gradientId})` : fillValue.color,
      "fill-opacity": gradient ? 1 : fillValue.opacity,
      stroke: strokeValue.color,
      "stroke-opacity": strokeValue.opacity,
      "stroke-width": item.stroke ? item.strokeWidth : 0,
    }
    if (item.strokeDash) common["stroke-dasharray"] = item.strokeDash
    if (item.shadow) common.filter = `url(#${shadowId})`

    if (item.imageFill) {
      return (
        <>
          <defs>
            <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
              {geometryNode({ fill: "#ffffff", stroke: "none", "stroke-width": 0 })}
            </clipPath>
          </defs>
          <image
            href={item.imageFill.src}
            ref={(node) => node.setAttributeNS("http://www.w3.org/1999/xlink", "href", item.imageFill?.src ?? "")}
            x={item.x}
            y={item.y}
            width={item.width}
            height={item.height}
            preserveAspectRatio="none"
            clip-path={`url(#${clipId})`}
            filter={item.shadow ? `url(#${shadowId})` : undefined}
          />
          {item.stroke
            ? geometryNode({
                fill: "none",
                stroke: strokeValue.color,
                "stroke-opacity": strokeValue.opacity,
                "stroke-width": item.strokeWidth,
                ...(item.strokeDash ? { "stroke-dasharray": item.strokeDash } : {}),
              })
            : null}
        </>
      )
    }

    return geometryNode(common)
  }

  return (
    <g transform={transform()}>
      <Show when={fillPaint()?.gradient}>
        {(gradient) => {
          const vector = gradientVector(gradient().angle)
          return (
            <defs>
              <linearGradient
                id={gradientId}
                x1={`${vector.x1 * 100}%`}
                y1={`${vector.y1 * 100}%`}
                x2={`${vector.x2 * 100}%`}
                y2={`${vector.y2 * 100}%`}
              >
                <For each={gradient().stops}>
                  {(stop) => (
                    <stop
                      offset={`${stop.offset * 100}%`}
                      stop-color={stop.color}
                      stop-opacity={String(stop.opacity)}
                    />
                  )}
                </For>
              </linearGradient>
            </defs>
          )
        }}
      </Show>
      <Show when={element().shadow}>
        {(shadow) => (
          <defs>
            <filter id={shadowId} x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow
                dx={String(shadow().dx)}
                dy={String(shadow().dy)}
                stdDeviation={String(Math.max(0.1, shadow().blur / 2))}
                flood-color={shadow().color}
                flood-opacity={String(shadow().opacity)}
              />
            </filter>
          </defs>
        )}
      </Show>
      {shapeNode()}
      {renderTextBlock(element().text, element(), { expandHeight: expandTextHeight() })}
    </g>
  )
}

function imagePaintBox(item: ImageElement): { x: number; y: number; width: number; height: number } {
  if (!item.crop) {
    return {
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    }
  }

  const visibleWidth = Math.max(0.01, 1 - item.crop.left - item.crop.right)
  const visibleHeight = Math.max(0.01, 1 - item.crop.top - item.crop.bottom)
  return {
    x: item.x - (item.width * item.crop.left) / visibleWidth,
    y: item.y - (item.height * item.crop.top) / visibleHeight,
    width: item.width / visibleWidth,
    height: item.height / visibleHeight,
  }
}

const SlideImage: Component<{ element: ImageElement }> = (props) => {
  const clipId = createUniqueId()
  const maskId = createUniqueId()
  const maskFilterId = createUniqueId()
  const element = () => props.element
  const box = () => imagePaintBox(element())
  const needsClip = () => Boolean(element().crop || element().softEdge)

  return (
    <g transform={rotationTransform(element())}>
      <Show when={needsClip()}>
        <defs>
          <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
            <rect x={element().x} y={element().y} width={element().width} height={element().height} />
          </clipPath>
        </defs>
      </Show>
      <Show when={element().softEdge}>
        {(softEdge) => {
          const feather = Math.max(1, Math.min(softEdge(), element().width * 0.35, element().height * 0.35))
          return (
            <defs>
              <filter
                id={maskFilterId}
                x={element().x}
                y={element().y}
                width={element().width}
                height={element().height}
                filterUnits="userSpaceOnUse"
              >
                <feGaussianBlur stdDeviation={String(feather * 0.55)} />
              </filter>
              <mask
                id={maskId}
                x={element().x}
                y={element().y}
                width={element().width}
                height={element().height}
                maskUnits="userSpaceOnUse"
                maskContentUnits="userSpaceOnUse"
                mask-type="alpha"
              >
                <rect x={element().x} y={element().y} width={element().width} height={element().height} fill="#000000" />
                <rect
                  x={element().x + feather}
                  y={element().y + feather}
                  width={Math.max(1, element().width - feather * 2)}
                  height={Math.max(1, element().height - feather * 2)}
                  fill="#ffffff"
                  filter={`url(#${maskFilterId})`}
                />
              </mask>
            </defs>
          )
        }}
      </Show>
      <image
        href={element().src}
        ref={(node) => node.setAttributeNS("http://www.w3.org/1999/xlink", "href", element().src)}
        x={box().x}
        y={box().y}
        width={box().width}
        height={box().height}
        opacity={String(element().opacity)}
        preserveAspectRatio="none"
        clip-path={needsClip() ? `url(#${clipId})` : undefined}
        mask={element().softEdge ? `url(#${maskId})` : undefined}
      />
    </g>
  )
}

const SlideElementView: Component<{ element: SlideElement }> = (props) => {
  return (
    <Switch>
      <Match when={props.element.kind === "shape"}>
        <SlideShape element={props.element as ShapeElement} />
      </Match>
      <Match when={props.element.kind === "image"}>
        <SlideImage element={props.element as ImageElement} />
      </Match>
      <Match when={props.element.kind === "line"}>
        {(() => {
          const item = props.element as LineElement
          const stroke = paintAttrs(item.stroke, "#374151")
          return (
            <line
              x1={item.x}
              y1={item.y}
              x2={item.x + item.width}
              y2={item.y + item.height}
              stroke={stroke.color}
              stroke-opacity={stroke.opacity}
              stroke-width={item.strokeWidth}
              stroke-linecap="round"
                  transform={rotationTransform(item)}
                  stroke-dasharray={item.strokeDash}
                />
              )
            })()}
      </Match>
      <Match when={props.element.kind === "table"}>
        {(() => {
          const item = props.element as TableElement
          const stroke = paintAttrs(item.stroke, "#d1d5db")
          return (
            <g transform={rotationTransform(item)}>
              <For each={item.cells}>
                {(cell) => {
                  const fill = paintAttrs(cell.fill, "#ffffff")
                  const cellElement: BaseElement = {
                    id: `${item.id}-cell`,
                    x: item.x + cell.x,
                    y: item.y + cell.y,
                    width: cell.width,
                    height: cell.height,
                  }
                  return (
                    <g>
                      <rect
                        x={cellElement.x}
                        y={cellElement.y}
                        width={cellElement.width}
                        height={cellElement.height}
                        fill={fill.color}
                        fill-opacity={fill.opacity}
                        stroke={stroke.color}
                        stroke-opacity={stroke.opacity}
                        stroke-width={1}
                      />
                      {renderTextBlock(cell.text, cellElement, { expandHeight: false })}
                    </g>
                  )
                }}
              </For>
            </g>
          )
        })()}
      </Match>
      <Match when={props.element.kind === "chart"}>
        <SlideChart element={props.element as ChartElement} />
      </Match>
    </Switch>
  )
}

const SlideView: Component<{ deck: Deck; slide: Slide; thumbnail?: boolean }> = (props) => {
  const background = () => paintAttrs(props.slide.background, "#ffffff")

  return (
    <svg
      viewBox={`0 0 ${props.deck.width} ${props.deck.height}`}
      class={props.thumbnail ? "block h-full w-full" : "block h-auto w-full shadow-sm"}
      role="img"
      aria-label={`Slide ${props.slide.index + 1}`}
      style={{ background: background().color }}
    >
      <rect
        width={props.deck.width}
        height={props.deck.height}
        fill={background().color}
        fill-opacity={background().opacity}
      />
      <For each={props.slide.elements}>{(element) => <SlideElementView element={element} />}</For>
    </svg>
  )
}

function commentMeta(comment: SlideComment): string {
  return [comment.author ?? comment.initials, comment.date].filter(Boolean).join(" / ")
}

const SlideAnnotations: Component<{ notes: string[]; comments: SlideComment[] }> = (props) => (
  <Show when={props.notes.length > 0 || props.comments.length > 0}>
    <section class="rounded-sm border border-border-weak-base bg-background-base shadow-sm">
      <div class="border-b border-border-weak-base px-4 py-2 text-12-medium text-text-strong">
        {props.notes.length > 0 && props.comments.length > 0 ? "备注 / 批注" : props.comments.length > 0 ? "批注" : "备注"}
      </div>
      <div class="space-y-4 px-4 py-3 text-13-regular leading-6 text-text-default">
        <Show when={props.notes.length > 0}>
          <div class="space-y-2">
            <Show when={props.comments.length > 0}>
              <div class="text-12-medium text-text-strong">备注</div>
            </Show>
            <For each={props.notes}>{(note) => <p class="m-0 whitespace-pre-wrap break-words">{note}</p>}</For>
          </div>
        </Show>
        <Show when={props.comments.length > 0}>
          <div class="space-y-3">
            <Show when={props.notes.length > 0}>
              <div class="text-12-medium text-text-strong">批注</div>
            </Show>
            <For each={props.comments}>
              {(comment) => (
                <div class="space-y-1">
                  <Show when={commentMeta(comment)}>
                    {(meta) => <div class="text-12-regular text-text-subtle">{meta()}</div>}
                  </Show>
                  <p class="m-0 whitespace-pre-wrap break-words">{comment.text}</p>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </section>
  </Show>
)

const SlidePlaceholder: Component<{
  deck: Deck
  index: number
  thumbnail?: boolean
  loading?: boolean
  error?: string
}> = (props) => {
  const label = () => {
    if (props.error) return props.thumbnail ? "!" : "幻灯片加载失败"
    if (props.loading) return "正在加载幻灯片..."
    return String(props.index + 1)
  }
  const fontSize = () => Math.max(18, Math.min(props.deck.width, props.deck.height) * (props.thumbnail ? 0.18 : 0.045))

  return (
    <svg
      viewBox={`0 0 ${props.deck.width} ${props.deck.height}`}
      class={props.thumbnail ? "block h-full w-full" : "block h-auto w-full shadow-sm"}
      role="img"
      aria-label={`Slide ${props.index + 1}`}
      style={{ background: "#ffffff" }}
    >
      <rect width={props.deck.width} height={props.deck.height} fill="#ffffff" />
      <text
        x={props.deck.width / 2}
        y={props.deck.height / 2}
        text-anchor="middle"
        dominant-baseline="middle"
        fill={props.error ? "#ef4444" : "#94a3b8"}
        font-size={String(fontSize())}
        font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
      >
        {label()}
      </text>
    </svg>
  )
}

async function parseShape(
  zip: JSZip,
  element: Element,
  relationships: Map<string, Relationship>,
  themeColors: ThemeColors,
  context: TransformContext,
  imageSources: ImageSourceStore,
  inheritedPlaceholder?: PlaceholderDefinition,
): Promise<ShapeElement | LineElement | undefined> {
  const properties = child(element, "spPr")
  const inheritedProperties = child(inheritedPlaceholder?.element, "spPr")
  const style = child(element, "style") ?? child(inheritedPlaceholder?.element, "style")
  const transform = parseTransform(properties, context) ?? parseTransform(inheritedProperties, context)
  if (!transform) return undefined

  const presetGeometry = firstDescendant(properties, "prstGeom") ?? firstDescendant(inheritedProperties, "prstGeom")
  const customGeometry = firstDescendant(properties, "custGeom") ?? firstDescendant(inheritedProperties, "custGeom")
  const shape = attr(presetGeometry, "prst") ?? (customGeometry ? "custom" : "rect")
  const ownLine = child(properties, "ln")
  const styleStroke = parseStylePaint(style, "lnRef", themeColors)
  const stroke = ownLine
    ? parseStroke(properties, themeColors)
    : inheritedProperties
      ? parseStroke(inheritedProperties, themeColors)
      : styleStroke
        ? { paint: styleStroke, width: 1 }
        : parseStroke(properties, themeColors)
  const hasNoFill = Boolean(child(properties, "noFill"))
  const hasOwnFill = hasExplicitFill(properties)
  const hasInheritedFill = hasExplicitFill(inheritedProperties)
  const styleFill = parseStylePaint(style, "fillRef", themeColors)
  const fill = hasNoFill
    ? undefined
    : hasOwnFill
      ? parseFill(properties, themeColors)
      : (parseFill(properties, themeColors) ?? parseFill(inheritedProperties, themeColors) ?? styleFill)
  const imageFill = await parseImageFill(zip, properties, relationships, imageSources)
  const text = parseTextBody(child(element, "txBody"), themeColors, child(inheritedPlaceholder?.element, "txBody"))
  const id = attr(firstDescendant(child(element, "nvSpPr"), "cNvPr"), "id") ?? crypto.randomUUID()

  if (shape === "line") {
    return {
      id,
      kind: "line",
      ...transform,
      stroke: stroke.paint,
      strokeWidth: stroke.width,
      strokeDash: stroke.dash,
    }
  }

  return {
    id,
    kind: "shape",
    shape,
    adjustments: parsePresetAdjustments(presetGeometry),
    ...transform,
    customPath: parseCustomGeometryPath(customGeometry, transform),
    customPoints: parseCustomGeometryPoints(customGeometry, transform),
    fill: fill ??
      (text || hasNoFill || hasOwnFill || hasInheritedFill || styleFill ? undefined : { color: "#e5e7eb", opacity: 1 }),
    imageFill,
    stroke: stroke.paint,
    strokeWidth: stroke.width,
    strokeDash: stroke.dash,
    shadow: parseOuterShadow(properties, themeColors),
    text,
  }
}

function parseConnectionShape(
  element: Element,
  themeColors: ThemeColors,
  context: TransformContext,
): LineElement | undefined {
  const properties = child(element, "spPr")
  const transform = parseTransform(properties, context)
  if (!transform) return undefined
  const stroke = parseStroke(properties, themeColors)
  const id = attr(firstDescendant(child(element, "nvCxnSpPr"), "cNvPr"), "id") ?? crypto.randomUUID()
  return {
    id,
    kind: "line",
    ...transform,
    stroke: stroke.paint,
    strokeWidth: stroke.width,
    strokeDash: stroke.dash,
  }
}

async function parsePicture(
  zip: JSZip,
  element: Element,
  relationships: Map<string, Relationship>,
  context: TransformContext,
  imageSources: ImageSourceStore,
): Promise<ImageElement | undefined> {
  const properties = child(element, "spPr")
  const transform = parseTransform(properties, context)
  if (!transform) return undefined

  const blip = firstDescendant(element, "blip")
  const relId = relAttr(blip)
  if (!relId) return undefined

  const relationship = relationships.get(relId)
  if (!relationship || relationship.external || !relationship.type.includes("/image")) return undefined

  const src = await loadImageSource(zip, relationship.target, imageSources)
  if (!src) return undefined

  return {
    id: attr(firstDescendant(child(element, "nvPicPr"), "cNvPr"), "id") ?? crypto.randomUUID(),
    kind: "image",
    ...transform,
    src,
    opacity: parseImageOpacity(blip),
    crop: parseImageCrop(child(element, "blipFill")),
    softEdge: parseSoftEdge(properties),
  }
}

function parseTable(element: Element, themeColors: ThemeColors, context: TransformContext): TableElement | undefined {
  const transform = parseTransform(element, context)
  const table = firstDescendant(element, "tbl")
  if (!transform || !table) return undefined

  const rows = children(table, "tr")
  const maxCellCount = Math.max(1, ...rows.map((row) => children(row, "tc").length))
  const rawColumnWidths = children(firstDescendant(table, "tblGrid"), "gridCol").map((column) => {
    const width = emuToPx(numericAttr(column, "w", 0))
    return width > 0 ? width : transform.width / maxCellCount
  })
  const fallbackColumnWidths = Array.from({ length: maxCellCount }, () => transform.width / maxCellCount)
  const rawRowHeights = rows.map((row) => emuToPx(numericAttr(row, "h", 0)) || transform.height / Math.max(1, rows.length))
  const normalizeSizes = (sizes: number[], target: number) => {
    const total = sizes.reduce((sum, value) => sum + value, 0)
    if (total <= 0) return sizes
    const scale = target / total
    return sizes.map((value) => value * scale)
  }
  const columnWidths = normalizeSizes(rawColumnWidths.length > 0 ? rawColumnWidths : fallbackColumnWidths, transform.width)
  const rowHeights = normalizeSizes(rawRowHeights, transform.height)
  const cells: TableCell[] = []
  const occupied = new Set<string>()
  let y = 0

  for (const [rowIndex, row] of rows.entries()) {
    const rowHeight = rowHeights[rowIndex] ?? transform.height / Math.max(1, rows.length)
    const rowCells = children(row, "tc")
    const hasExplicitMergePlaceholders = rowCells.length >= columnWidths.length
    let columnIndex = 0
    for (const cellElement of rowCells) {
      const colSpan = Math.max(1, numericAttr(cellElement, "gridSpan", 1))
      const rowSpan = Math.max(1, numericAttr(cellElement, "rowSpan", 1))
      const isContinuation = ["1", "true"].includes(localAttr(cellElement, "hMerge") ?? "") ||
        ["1", "true"].includes(localAttr(cellElement, "vMerge") ?? "")

      if (isContinuation) {
        columnIndex += 1
        continue
      }

      while (occupied.has(`${rowIndex}:${columnIndex}`)) columnIndex += 1

      const x = columnWidths.slice(0, columnIndex).reduce((sum, width) => sum + width, 0)
      const width = columnWidths
        .slice(columnIndex, columnIndex + colSpan)
        .reduce((sum, value) => sum + value, 0) || columnWidths[columnIndex] || transform.width / maxCellCount
      const height = rowHeights.slice(rowIndex, rowIndex + rowSpan).reduce((sum, value) => sum + value, 0) || rowHeight
      const properties = child(cellElement, "tcPr")
      const text = applyTableCellTextProperties(parseTextBody(child(cellElement, "txBody"), themeColors), properties)
      cells.push({
        x,
        y,
        width,
        height,
        fill: parseFill(properties, themeColors),
        text,
      })

      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) {
          if (rowOffset === 0 && columnOffset === 0) continue
          occupied.add(`${rowIndex + rowOffset}:${columnIndex + columnOffset}`)
        }
      }

      columnIndex += hasExplicitMergePlaceholders ? 1 : colSpan
    }
    y += rowHeight
  }

  return {
    id: attr(firstDescendant(child(element, "nvGraphicFramePr"), "cNvPr"), "id") ?? crypto.randomUUID(),
    kind: "table",
    ...transform,
    cells,
    stroke: { color: "#d1d5db", opacity: 1 },
  }
}

function parseCacheText(cache: Element | undefined): Map<number, string> {
  const result = new Map<number, string>()
  if (!cache) return result

  for (const point of children(cache, "pt")) {
    const index = numericAttr(point, "idx", result.size)
    const value = firstDescendant(point, "v")?.textContent?.trim()
    if (value) result.set(index, value)
  }

  return result
}

function parseCacheNumbers(cache: Element | undefined): Array<{ index: number; value: number }> {
  if (!cache) return []

  return children(cache, "pt")
    .map((point, fallbackIndex) => {
      const index = numericAttr(point, "idx", fallbackIndex)
      const value = Number(firstDescendant(point, "v")?.textContent ?? "0")
      return Number.isFinite(value) ? { index, value } : undefined
    })
    .filter((point): point is { index: number; value: number } => Boolean(point))
}

function parseChartColors(series: Element, themeColors: ThemeColors): Map<number, string> {
  const result = new Map<number, string>()

  for (const point of descendants(series, "dPt")) {
    const index = numericAttr(child(point, "idx"), "val", result.size)
    const color = parseFill(child(point, "spPr"), themeColors)?.color
    if (color) result.set(index, color)
  }

  return result
}

function parseAxisNumber(axis: Element | undefined, localName: string): number | undefined {
  const value = Number(localAttr(child(child(axis, "scaling"), localName), "val"))
  return finiteOrUndefined(value)
}

function parseAxisMajorUnit(axis: Element | undefined): number | undefined {
  const value = Number(localAttr(child(axis, "majorUnit"), "val"))
  return value > 0 ? finiteOrUndefined(value) : undefined
}

async function parseChart(
  zip: JSZip,
  element: Element,
  relationships: Map<string, Relationship>,
  themeColors: ThemeColors,
  context: TransformContext,
): Promise<ChartElement | undefined> {
  const transform = parseTransform(element, context)
  if (!transform) return undefined

  const chartReference = firstDescendant(element, "chart")
  const relId = relAttr(chartReference)
  if (!relId) return undefined

  const relationship = relationships.get(relId)
  if (!relationship || relationship.external || !relationship.type.includes("/chart")) return undefined

  const chartXml = await readZipText(zip, relationship.target)
  if (!chartXml) return undefined

  const doc = parseXml(chartXml)
  const plotArea = firstDescendant(doc, "plotArea")
  const pieChart = firstDescendant(plotArea, "pieChart")
  const barChart = firstDescendant(plotArea, "barChart")
  const chartNode = pieChart ?? barChart
  if (!chartNode) return undefined

  const series = firstDescendant(chartNode, "ser")
  if (!series) return undefined
  const categories = child(series, "cat")
  const values = child(series, "val")
  const stringLabels = parseCacheText(firstDescendant(categories, "strCache"))
  const labelByIndex = stringLabels.size > 0 ? stringLabels : parseCacheText(firstDescendant(categories, "numCache"))
  const valuePoints = parseCacheNumbers(firstDescendant(values, "numCache"))
  if (valuePoints.length === 0) return undefined

  const colorByIndex = parseChartColors(series, themeColors)
  const seriesColor = parseFill(child(series, "spPr"), themeColors)?.color
  const colors = valuePoints.map(
    (point, order) => colorByIndex.get(point.index) ?? seriesColor ?? chartPalette[order % chartPalette.length],
  )
  const points = valuePoints.map((point, order) => ({
    label: labelByIndex.get(point.index) ?? `项目 ${order + 1}`,
    value: point.value,
    color: colors[order],
  }))
  const title = chartTitleText(child(firstDescendant(doc, "chart"), "title"))
  const categoryAxis = firstDescendant(plotArea, "catAx")
  const valueAxis = firstDescendant(plotArea, "valAx")

  return {
    id: attr(firstDescendant(child(element, "nvGraphicFramePr"), "cNvPr"), "id") ?? crypto.randomUUID(),
    kind: "chart",
    ...transform,
    chartType: pieChart ? "pie" : "bar",
    title,
    xAxisTitle: chartTitleText(child(categoryAxis, "title")),
    yAxisTitle: chartTitleText(child(valueAxis, "title")),
    axisMin: parseAxisNumber(valueAxis, "min"),
    axisMax: parseAxisNumber(valueAxis, "max"),
    axisMajorUnit: parseAxisMajorUnit(valueAxis),
    points,
    colors,
    showGridLines: Boolean(child(valueAxis, "majorGridlines")),
  }
}

async function parseSlideTree(
  zip: JSZip,
  element: Element,
  relationships: Map<string, Relationship>,
  themeColors: ThemeColors,
  context: TransformContext,
  imageSources: ImageSourceStore,
  options: SlideTreeParseOptions = {},
): Promise<SlideElement[]> {
  const elements: SlideElement[] = []

  for (const item of children(element)) {
    if (item.localName === "sp") {
      const placeholder = placeholderForShape(item)
      if (placeholder && options.skipPlaceholderElements) continue
      const parsed = await parseShape(
        zip,
        item,
        relationships,
        themeColors,
        context,
        imageSources,
        placeholderDefinitionFor(placeholder, options.inheritedPlaceholders),
      )
      if (parsed) elements.push(parsed)
    } else if (item.localName === "cxnSp") {
      const parsed = parseConnectionShape(item, themeColors, context)
      if (parsed) elements.push(parsed)
    } else if (item.localName === "pic") {
      const parsed = await parsePicture(zip, item, relationships, context, imageSources)
      if (parsed) elements.push(parsed)
    } else if (item.localName === "graphicFrame") {
      const parsed =
        (await parseChart(zip, item, relationships, themeColors, context)) ?? parseTable(item, themeColors, context)
      if (parsed) elements.push(parsed)
    } else if (item.localName === "grpSp") {
      const groupContext = parseGroupContext(item, context)
      elements.push(
        ...(await parseSlideTree(zip, item, relationships, themeColors, groupContext, imageSources, options)),
      )
    }
  }

  return elements
}

function parseSlideBackground(slide: Document | undefined, themeColors: ThemeColors): Paint | undefined {
  const backgroundProperties = firstDescendant(firstDescendant(slide, "bg"), "bgPr")
  return parseFill(backgroundProperties, themeColors)
}

function parseNotesText(notesSlide: Document | undefined): string[] {
  const notes: string[] = []
  for (const shape of descendants(notesSlide, "sp")) {
    const placeholder = firstDescendant(child(shape, "nvSpPr"), "ph")
    if (attr(placeholder, "type") !== "body") continue

    for (const paragraph of descendants(child(shape, "txBody"), "p")) {
      const text = descendants(paragraph, "t")
        .map((node) => node.textContent ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim()
      if (text) notes.push(text)
    }
  }
  return notes
}

function normalizeAnnotationText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
}

function parseCommentAuthorsFromDocument(doc: Document | undefined, authors: Map<string, CommentAuthor>) {
  for (const author of descendants(doc, "cmAuthor")) {
    const id = localAttr(author, "id")
    if (!id) continue
    authors.set(id, {
      name: localAttr(author, "name"),
      initials: localAttr(author, "initials"),
    })
  }
}

async function parseCommentAuthors(zip: JSZip): Promise<Map<string, CommentAuthor>> {
  const authors = new Map<string, CommentAuthor>()
  const authorParts = Object.keys(zip.files).filter((path) => /(^|\/)commentAuthors\.xml$/i.test(path))
  if (authorParts.length === 0 && zip.file("ppt/commentAuthors.xml")) authorParts.push("ppt/commentAuthors.xml")

  for (const authorPart of authorParts) {
    parseCommentAuthorsFromDocument(await readXmlPart(zip, authorPart), authors)
  }

  return authors
}

function parseCommentText(comment: Element): string {
  const drawingText = descendants(comment, "t")
    .map((node) => node.textContent ?? "")
    .join("")
  if (drawingText.trim()) return normalizeAnnotationText(drawingText)

  const textElements = descendants(comment, "text")
    .map((node) => node.textContent ?? "")
    .filter((text) => text.trim())
  if (textElements.length > 0) return normalizeAnnotationText(textElements.join("\n"))

  return normalizeAnnotationText(comment.textContent ?? "")
}

function parseCommentDate(comment: Element): string | undefined {
  return (
    localAttr(comment, "dt") ??
    localAttr(comment, "date") ??
    localAttr(comment, "created") ??
    localAttr(comment, "createdDate") ??
    localAttr(comment, "creationDate")
  )
}

function commentNodes(commentsDoc: Document | undefined): Element[] {
  if (!commentsDoc) return []
  const names = new Set(["cm", "comment", "threadedComment"])
  const root = commentsDoc.documentElement
  return [
    ...(names.has(root.localName) ? [root] : []),
    ...(Array.from(root.getElementsByTagName("*")) as Element[]).filter((element) => names.has(element.localName)),
  ]
}

function parseCommentsText(commentsDoc: Document | undefined, authors: Map<string, CommentAuthor>): SlideComment[] {
  return commentNodes(commentsDoc)
    .map((comment) => {
      const text = parseCommentText(comment)
      if (!text) return undefined

      const authorId = localAttr(comment, "authorId") ?? localAttr(comment, "authorID")
      const author = authorId ? authors.get(authorId) : undefined
      const result: SlideComment = { text }
      const authorName = localAttr(comment, "author") ?? author?.name
      const initials = localAttr(comment, "initials") ?? author?.initials
      const date = parseCommentDate(comment)
      if (authorName) result.author = authorName
      if (initials) result.initials = initials
      if (date) result.date = date
      return result
    })
    .filter((comment): comment is SlideComment => Boolean(comment))
}

function commentRelationshipTargets(relationships: Map<string, Relationship>): string[] {
  const targets = new Set<string>()
  for (const relationship of relationships.values()) {
    const type = relationship.type.toLowerCase()
    if (!relationship.external && type.includes("/comment") && !type.includes("/commentauthors")) {
      targets.add(relationship.target)
    }
  }
  return Array.from(targets)
}

async function parseSlideComments(
  zip: JSZip,
  relationships: Map<string, Relationship>,
  authors: Map<string, CommentAuthor>,
): Promise<SlideComment[]> {
  const comments: SlideComment[] = []
  for (const commentsPath of commentRelationshipTargets(relationships)) {
    comments.push(...parseCommentsText(await readXmlPart(zip, commentsPath), authors))
  }
  return comments
}

function firstRelationshipTarget(relationships: Map<string, Relationship>, typeSuffix: string): string | undefined {
  for (const relationship of relationships.values()) {
    if (!relationship.external && relationship.type.includes(typeSuffix)) return relationship.target
  }
  return undefined
}

async function readXmlPart(zip: JSZip, partPath: string | undefined): Promise<Document | undefined> {
  if (!partPath) return undefined
  const text = await readZipText(zip, partPath)
  return text ? parseXml(text) : undefined
}

async function parseSlide(
  zip: JSZip,
  slidePath: string,
  index: number,
  deckWidth: number,
  deckHeight: number,
  themeColors: ThemeColors,
  imageSources: ImageSourceStore,
  commentAuthors: Map<string, CommentAuthor>,
): Promise<Slide> {
  const text = await readZipText(zip, slidePath)
  if (!text) throw new Error(`找不到幻灯片内容：${slidePath}`)

  const doc = parseXml(text)
  const relationships = await parseRelationships(zip, slidePath)
  const layoutPath = firstRelationshipTarget(relationships, "/slideLayout")
  const notesPath = firstRelationshipTarget(relationships, "/notesSlide")
  const layoutDoc = await readXmlPart(zip, layoutPath)
  const notesDoc = await readXmlPart(zip, notesPath)
  const comments = await parseSlideComments(zip, relationships, commentAuthors)
  const layoutRelationships = layoutPath ? await parseRelationships(zip, layoutPath) : new Map<string, Relationship>()
  const masterPath = firstRelationshipTarget(layoutRelationships, "/slideMaster")
  const masterDoc = await readXmlPart(zip, masterPath)
  const masterRelationships = masterPath ? await parseRelationships(zip, masterPath) : new Map<string, Relationship>()
  const inheritedPlaceholders = new Map<string, PlaceholderDefinition>()
  collectPlaceholderDefinitions(firstDescendant(masterDoc, "spTree"), inheritedPlaceholders)
  collectPlaceholderDefinitions(firstDescendant(layoutDoc, "spTree"), inheritedPlaceholders)

  const context = { x: 0, y: 0, scaleX: 1, scaleY: 1 }
  const masterTree = firstDescendant(masterDoc, "spTree")
  const masterElements = masterTree
    ? await parseSlideTree(zip, masterTree, masterRelationships, themeColors, context, imageSources, {
        skipPlaceholderElements: true,
      })
    : []
  const layoutTree = firstDescendant(layoutDoc, "spTree")
  const layoutElements = layoutTree
    ? await parseSlideTree(zip, layoutTree, layoutRelationships, themeColors, context, imageSources, {
        skipPlaceholderElements: true,
      })
    : []
  const slideTree = firstDescendant(doc, "spTree")
  const elements = slideTree
    ? await parseSlideTree(zip, slideTree, relationships, themeColors, context, imageSources, { inheritedPlaceholders })
    : []
  const allElements = [...masterElements, ...layoutElements, ...elements]
  const title =
    elements.map((element) => ("text" in element ? textPreview(element.text) : "")).find(Boolean) ||
    `幻灯片 ${index + 1}`

  return {
    id: slidePath,
    index,
    title,
    notes: parseNotesText(notesDoc),
    comments,
    background: parseSlideBackground(doc, themeColors) ??
      parseSlideBackground(layoutDoc, themeColors) ??
      parseSlideBackground(masterDoc, themeColors) ?? { color: "#ffffff", opacity: 1 },
    elements: allElements,
  }
}

function fallbackSlidePaths(zip: JSZip): string[] {
  return Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const aNumber = Number(a.match(/slide(\d+)\.xml$/i)?.[1] ?? "0")
      const bNumber = Number(b.match(/slide(\d+)\.xml$/i)?.[1] ?? "0")
      return aNumber - bNumber
    })
}

async function parseDeck(buffer: ArrayBuffer): Promise<Deck> {
  const JSZipConstructor = (await import("jszip")).default
  const zip = await JSZipConstructor.loadAsync(buffer)
  const presentationXml = await readZipText(zip, "ppt/presentation.xml")
  if (!presentationXml) throw new Error("找不到 ppt/presentation.xml")

  const presentation = parseXml(presentationXml)
  const size = firstDescendant(presentation, "sldSz")
  const deckWidth = emuToPx(numericAttr(size, "cx", DEFAULT_SLIDE_WIDTH_EMU))
  const deckHeight = emuToPx(numericAttr(size, "cy", DEFAULT_SLIDE_HEIGHT_EMU))
  const themeColors = parseThemeColors(await readZipText(zip, "ppt/theme/theme1.xml"))
  const presentationRelationships = await parseRelationships(zip, "ppt/presentation.xml")
  const commentAuthors = await parseCommentAuthors(zip)
  const imageSources: ImageSourceStore = {
    cache: new Map<string, string>(),
    objectUrls: new Set<string>(),
    disposed: false,
  }

  let slidePaths = descendants(presentation, "sldId")
    .map((slideId) => {
      const relationshipId = relAttr(slideId)
      return relationshipId ? presentationRelationships.get(relationshipId)?.target : undefined
    })
    .filter((value): value is string => Boolean(value))

  if (slidePaths.length === 0) slidePaths = fallbackSlidePaths(zip)
  if (slidePaths.length === 0) throw new Error("这个演示文稿没有可读取的幻灯片")

  const slides = slidePaths.map((slidePath, index) => ({
    id: slidePath,
    index,
    path: slidePath,
    title: `幻灯片 ${index + 1}`,
  }))

  const loadSlide = (index: number) => {
    const slide = slides[index]
    if (!slide) return Promise.reject(new Error(`找不到第 ${index + 1} 页幻灯片`))
    return parseSlide(zip, slide.path, index, deckWidth, deckHeight, themeColors, imageSources, commentAuthors)
  }

  return {
    width: deckWidth,
    height: deckHeight,
    slides,
    loadSlide,
    dispose: () => disposeImageSources(imageSources),
  }
}

const PPTX_EAGER_PARSE_MAX_BYTES = 20 * 1024 * 1024
const PPTX_EAGER_PARSE_MAX_SLIDES = 30
const PPTX_ADJACENT_PREFETCH_RADIUS = 1
const PPTX_THUMBNAIL_PREFETCH_RADIUS = 5
const PPTX_THUMBNAIL_INTERACTION_PREFETCH_RADIUS = 2

function shouldEagerParseDeck(deck: Deck, byteLength: number): boolean {
  return byteLength <= PPTX_EAGER_PARSE_MAX_BYTES && deck.slides.length <= PPTX_EAGER_PARSE_MAX_SLIDES
}

export const PptxRenderer: Component<{ buffer: ArrayBuffer; path: string }> = (props) => {
  const [deck, setDeck] = createSignal<Deck>()
  const [slideCache, setSlideCache] = createSignal<Record<number, Slide>>({})
  const [slideLoading, setSlideLoading] = createSignal<Record<number, boolean>>({})
  const [slideErrors, setSlideErrors] = createSignal<Record<number, string>>({})
  const [activeSlide, setActiveSlide] = createSignal(0)
  const [thumbnailsCollapsed, setThumbnailsCollapsed] = createSignal(false)
  const [thumbnailScroll, setThumbnailScroll] = createSignal({ left: 0, max: 0 })
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string>()
  const pendingSlides = new Map<number, Promise<Slide>>()
  let thumbnailStrip: HTMLDivElement | undefined
  let thumbnailResizeObserver: ResizeObserver | undefined
  let deckGeneration = 0

  const updateThumbnailScroll = () => {
    const strip = thumbnailStrip
    if (!strip) return
    const next = {
      left: strip.scrollLeft,
      max: Math.max(0, strip.scrollWidth - strip.clientWidth),
    }
    setThumbnailScroll((current) =>
      Math.abs(current.left - next.left) < 0.5 && Math.abs(current.max - next.max) < 0.5 ? current : next,
    )
  }

  const setThumbnailStrip = (element: HTMLDivElement) => {
    thumbnailStrip = element
    thumbnailResizeObserver?.disconnect()
    thumbnailResizeObserver = new ResizeObserver(updateThumbnailScroll)
    thumbnailResizeObserver.observe(element)
    requestAnimationFrame(updateThumbnailScroll)
  }

  const setThumbnailScrollLeft = (value: number) => {
    const strip = thumbnailStrip
    if (!strip) return
    strip.scrollLeft = Math.max(0, Math.min(value, strip.scrollWidth - strip.clientWidth))
    updateThumbnailScroll()
  }

  const ensureSlide = (index: number) => {
    const parsed = deck()
    if (!parsed || index < 0 || index >= parsed.slides.length) return
    if (slideCache()[index] || pendingSlides.has(index)) return

    const generation = deckGeneration
    const request = parsed.loadSlide(index)
    pendingSlides.set(index, request)
    setSlideLoading((state) => ({ ...state, [index]: true }))

    request
      .then((slide) => {
        if (generation !== deckGeneration) return
        setSlideCache((state) => ({ ...state, [index]: slide }))
        setSlideErrors((state) => {
          const next = { ...state }
          delete next[index]
          return next
        })
        setDeck((current) => {
          if (!current) return current
          const reference = current.slides[index]
          if (!reference || reference.title === slide.title) return current
          const slides = current.slides.slice()
          slides[index] = { ...reference, title: slide.title }
          return { ...current, slides }
        })
      })
      .catch((e) => {
        if (generation !== deckGeneration) return
        setSlideErrors((state) => ({ ...state, [index]: e instanceof Error ? e.message : "幻灯片解析失败" }))
      })
      .finally(() => {
        if (pendingSlides.get(index) === request) pendingSlides.delete(index)
        if (generation !== deckGeneration) return
        setSlideLoading((state) => {
          const next = { ...state }
          delete next[index]
          return next
        })
      })
  }

  const ensureSlideRange = (center: number, radius: number) => {
    for (let offset = -radius; offset <= radius; offset++) {
      ensureSlide(center + offset)
    }
  }

  const ensureAllSlides = () => {
    const parsed = deck()
    if (!parsed) return
    for (let index = 0; index < parsed.slides.length; index++) ensureSlide(index)
  }

  createEffect(() => {
    const buffer = props.buffer
    let disposed = false
    let loadedDeck: Deck | undefined
    deckGeneration += 1
    const generation = deckGeneration
    pendingSlides.clear()
    setLoading(true)
    setError(undefined)
    setDeck(undefined)
    setSlideCache({})
    setSlideLoading({})
    setSlideErrors({})
    setActiveSlide(0)

    parseDeck(buffer)
      .then((parsed) => {
        if (disposed || generation !== deckGeneration) {
          parsed.dispose()
          return
        }
        loadedDeck = parsed
        setDeck(parsed)
        setLoading(false)
        if (shouldEagerParseDeck(parsed, buffer.byteLength)) {
          untrack(ensureAllSlides)
        }
      })
      .catch((e) => {
        if (disposed || generation !== deckGeneration) return
        setError(e instanceof Error ? e.message : "演示文稿渲染失败")
        setLoading(false)
      })

    onCleanup(() => {
      disposed = true
      loadedDeck?.dispose()
    })
  })

  createEffect(() => {
    const parsed = deck()
    if (!parsed) return
    const index = activeSlide()
    untrack(() => {
      const radius = thumbnailsCollapsed()
        ? PPTX_ADJACENT_PREFETCH_RADIUS
        : Math.max(PPTX_ADJACENT_PREFETCH_RADIUS, PPTX_THUMBNAIL_PREFETCH_RADIUS)
      ensureSlideRange(index, radius)
    })
  })

  createEffect(() => {
    const index = activeSlide()
    if (thumbnailsCollapsed()) return

    queueMicrotask(() => {
      thumbnailStrip
        ?.querySelector<HTMLElement>(`[data-slide-index="${index}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" })
    })
  })

  onCleanup(() => thumbnailResizeObserver?.disconnect())

  const goPrevious = () => setActiveSlide((value) => Math.max(0, value - 1))
  const goNext = () => setActiveSlide((value) => Math.min((deck()?.slides.length ?? 1) - 1, value + 1))

  return (
    <Switch>
      <Match when={loading()}>
        <div class="px-6 py-4 text-text-weak">正在加载演示文稿...</div>
      </Match>
      <Match when={error()}>
        {(message) => (
          <FilePreviewFallback
            path={props.path}
            title="无法预览 PowerPoint 文件"
            description={`Parvis 无法解析这个 .pptx：${message()}。请使用 PowerPoint、WPS 或其他兼容软件打开。`}
          />
        )}
      </Match>
      <Match when={deck()}>
        {(parsedDeck) => {
          const currentReference = () => parsedDeck().slides[activeSlide()] ?? parsedDeck().slides[0]
          const currentSlide = () => slideCache()[activeSlide()]
          const currentTitle = () => currentSlide()?.title ?? currentReference()?.title ?? ""

          return (
            <div class="flex h-full min-h-0 min-w-0 flex-col bg-background-stronger text-text-default">
              <style>
                {`
                  .parvis-pptx-thumbnail-strip {
                    scrollbar-width: none;
                    overscroll-behavior-x: contain;
                  }
                  .parvis-pptx-thumbnail-strip::-webkit-scrollbar {
                    display: none;
                    height: 0;
                    width: 0;
                  }
                  .parvis-pptx-thumbnail-slider {
                    appearance: none;
                    display: block;
                    width: 100%;
                    height: 12px;
                    background: transparent;
                    cursor: pointer;
                  }
                  .parvis-pptx-thumbnail-slider::-webkit-slider-runnable-track {
                    height: 4px;
                    border-radius: 999px;
                    background: var(--surface-base-active);
                  }
                  .parvis-pptx-thumbnail-slider::-webkit-slider-thumb {
                    appearance: none;
                    width: 48px;
                    height: 10px;
                    margin-top: -3px;
                    border: 1px solid var(--border-base);
                    border-radius: 999px;
                    background: var(--surface-raised-stronger-non-alpha);
                    box-shadow: var(--shadow-xs);
                  }
                  .parvis-pptx-thumbnail-slider::-moz-range-track {
                    height: 4px;
                    border: 0;
                    border-radius: 999px;
                    background: var(--surface-base-active);
                  }
                  .parvis-pptx-thumbnail-slider::-moz-range-thumb {
                    width: 48px;
                    height: 10px;
                    border: 1px solid var(--border-base);
                    border-radius: 999px;
                    background: var(--surface-raised-stronger-non-alpha);
                    box-shadow: var(--shadow-xs);
                  }
                  .parvis-pptx-thumbnail-slider:focus-visible {
                    outline: 1px solid var(--border-strong-base);
                    outline-offset: 1px;
                  }
                `}
              </style>
              <section class="flex min-h-0 min-w-0 flex-1 flex-col bg-background-stronger">
                <div class="flex h-[28px] shrink-0 items-center gap-[4px] border-b border-border-weak-base bg-background-base px-[8px]">
                  <button
                    type="button"
                    class="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded border border-border-weak-base bg-background-base text-text-strong shadow-sm transition-colors hover:bg-background-stronger"
                    onClick={() => setThumbnailsCollapsed((collapsed) => !collapsed)}
                    title={thumbnailsCollapsed() ? "Show slide thumbnails" : "Hide slide thumbnails"}
                    aria-label={thumbnailsCollapsed() ? "Show slide thumbnails" : "Hide slide thumbnails"}
                  >
                    <Show when={thumbnailsCollapsed()} fallback={<PanelBottomClose size={16} />}>
                      <PanelBottomOpen size={16} />
                    </Show>
                  </button>
                  <button
                    type="button"
                    class="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded border border-border-weak-base bg-background-base text-text-strong shadow-sm transition-colors hover:bg-background-stronger disabled:cursor-default disabled:text-text-weak disabled:shadow-none"
                    disabled={activeSlide() === 0}
                    onClick={goPrevious}
                    title="Previous slide"
                    aria-label="Previous slide"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    type="button"
                    class="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded border border-border-weak-base bg-background-base text-text-strong shadow-sm transition-colors hover:bg-background-stronger disabled:cursor-default disabled:text-text-weak disabled:shadow-none"
                    disabled={activeSlide() >= parsedDeck().slides.length - 1}
                    onClick={goNext}
                    title="Next slide"
                    aria-label="Next slide"
                  >
                    <ChevronRight size={16} />
                  </button>
                  <div class="min-w-0 flex-1 truncate text-[12px] leading-[16px] text-text-strong" title={currentTitle()}>
                    {currentTitle()}
                  </div>
                  <div class="shrink-0 text-[12px] leading-[16px] tabular-nums text-text-default">
                    {activeSlide() + 1} / {parsedDeck().slides.length}
                  </div>
                </div>
                <div class="min-h-0 flex-1 overflow-auto bg-background-stronger">
                  <div class="flex justify-center px-4 py-5 sm:px-6 lg:px-8">
                    <div class="flex w-full max-w-[1440px] flex-col gap-3">
                      <div class="overflow-hidden rounded-sm border border-border-weak-base bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08),0_18px_42px_rgba(15,23,42,0.16)] ring-1 ring-black/5">
                        <Show
                          when={currentSlide()}
                          fallback={
                            <SlidePlaceholder
                              deck={parsedDeck()}
                              index={activeSlide()}
                              loading={slideLoading()[activeSlide()]}
                              error={slideErrors()[activeSlide()]}
                            />
                          }
                        >
                          {(parsedSlide) => <SlideView deck={parsedDeck()} slide={parsedSlide()} />}
                        </Show>
                      </div>
                      <Show when={currentSlide()}>
                        {(parsedSlide) => (
                          <SlideAnnotations notes={parsedSlide().notes} comments={parsedSlide().comments} />
                        )}
                      </Show>
                    </div>
                  </div>
                </div>
              </section>
              <Show when={!thumbnailsCollapsed()}>
                <aside class="flex h-[152px] shrink-0 flex-col border-t border-border-weak-base bg-background-base">
                  <div
                    ref={setThumbnailStrip}
                    class="parvis-pptx-thumbnail-strip flex min-h-0 flex-1 gap-2 overflow-x-scroll overflow-y-hidden px-3 pb-1 pt-2"
                    onScroll={updateThumbnailScroll}
                    onWheel={(event) => {
                      const strip = event.currentTarget
                      const max = Math.max(0, strip.scrollWidth - strip.clientWidth)
                      if (max <= 0) return

                      const dominantDelta =
                        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
                      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1
                      const next = Math.max(0, Math.min(strip.scrollLeft + dominantDelta * unit, max))
                      if (Math.abs(next - strip.scrollLeft) < 0.5) return

                      event.preventDefault()
                      setThumbnailScrollLeft(next)
                    }}
                  >
                    <For each={parsedDeck().slides}>
                      {(slide, index) => {
                        const loadedSlide = () => slideCache()[index()]
                        const slideTitle = () => loadedSlide()?.title ?? slide.title
                        const loadThumbnail = () =>
                          ensureSlideRange(index(), PPTX_THUMBNAIL_INTERACTION_PREFETCH_RADIUS)
                        return (
                          <button
                            type="button"
                            data-slide-index={index()}
                            aria-current={activeSlide() === index() ? "page" : undefined}
                            class={`group w-[176px] shrink-0 rounded-md border p-1.5 text-left transition-colors ${
                              activeSlide() === index()
                                ? "border-border-base bg-background-selected"
                                : "border-border-weak-base bg-background-base hover:bg-background-stronger"
                            }`}
                            onClick={() => {
                              setActiveSlide(index())
                              loadThumbnail()
                            }}
                            onMouseEnter={loadThumbnail}
                            onFocus={loadThumbnail}
                            title={slideTitle()}
                          >
                            <div
                              class="overflow-hidden rounded border border-border-weak-base bg-white"
                              style={{ "aspect-ratio": `${parsedDeck().width} / ${parsedDeck().height}` }}
                            >
                              <Show
                                when={loadedSlide()}
                                fallback={
                                  <SlidePlaceholder
                                    deck={parsedDeck()}
                                    index={index()}
                                    thumbnail
                                    loading={slideLoading()[index()]}
                                    error={slideErrors()[index()]}
                                  />
                                }
                              >
                                {(parsedSlide) => <SlideView deck={parsedDeck()} slide={parsedSlide()} thumbnail />}
                              </Show>
                            </div>
                            <div class="mt-1 flex items-center gap-1 text-12-regular text-text-weak">
                              <span class="shrink-0 tabular-nums">{index() + 1}</span>
                              <span class="truncate">{slideTitle()}</span>
                            </div>
                          </button>
                        )
                      }}
                    </For>
                  </div>
                  <Show when={thumbnailScroll().max > 1}>
                    <div class="h-[12px] shrink-0 bg-background-base px-1">
                      <input
                        type="range"
                        min="0"
                        max={thumbnailScroll().max}
                        step="1"
                        value={thumbnailScroll().left}
                        class="parvis-pptx-thumbnail-slider"
                        onInput={(event) => setThumbnailScrollLeft(Number(event.currentTarget.value))}
                        aria-label="幻灯片缩略图横向滚动位置"
                      />
                    </div>
                  </Show>
                </aside>
              </Show>
            </div>
          )
        }}
      </Match>
    </Switch>
  )
}
