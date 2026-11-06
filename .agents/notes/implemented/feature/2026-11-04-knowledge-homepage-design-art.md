# Agent Note: Knowledge homepage design art

Status: implemented

English | [中文](2026-11-04-knowledge-homepage-design-art.zh.md)

## Problem

The desktop Knowledge homepage FeaturePanel header showed only the WANWEI Buddy kicker, title, and subtitle, so it did not match the product design's right-side glassmorphism hero. The sidebar plaza entry used a generic SVG house icon on a flat blue card, and the selected-library header used an inline SVG folder instead of the staged product folder mark.

## Decision

`FeaturePanel` accepts optional `headerArt` (absolute URL). Knowledge registers `/knowledge-covers/hero-banner.png`, which the header shows at a fixed **185px** height, right-aligned, with `object-fit: contain`. The shipped PNG is a 2× raster (3280×370) derived from the design-height `plaza-bg-top.png` (1640×185); chat-compressed 1024×115 previews must not replace it. Product assets live under `products/wanwei-desktop/assets/web/knowledge-covers/`. The plaza launch uses the js.design plate `plaza-entry.png` as a full-bleed background, with locale-owned copy overlaid (`#222` title, `#177cee` subtitle) and the design circular chevron `icon-plaza-launch-arrow.png` instead of an inline SVG. Plaza list and detail use an opaque `#f5f8fc` plate plus soft wash `plaza-page-bg.png`, with solid white cards so the knowledge shell underneath cannot show through. Sidebar group counts place a centered `#237df5` digit on a soft light-blue disc shaped from `icon-group-count-bg.png` (same lightness family as the content count chip). Small chrome icons (sidebar groups, chat toggle, library header tile, PDF glyph, clock) use the js.design PNG cutouts staged 2–3× under `knowledge-covers/` so design colors stay exact; empty library descriptions are omitted. Base `.dsh-knowledge-file-icon` sizes and clips those PDF/Word `<img>` marks (30×30, `object-fit: contain`, `overflow: hidden`) so non-card hosts such as the preview-ask file chip do not paint native 2–3× pixels; content cards keep their 36×36 override. Sidebar library cards follow the js.design knowledge frame: white fill, `border-radius: 10px`, idle border `#dbe4f0`, selected border `#2294ff`, title-only header (optional one-line description), 12px chat toggle at the top-right, and a 2×2 meta grid with label and value on one line per cell (`维护者 值 | 更新时间 值` / `文件数量 值 | 文件大小 值`) without a divider or cover avatar; file size uses KB under 1MB. The sidebar search is a flat 36×10px field (`border #dbe4f0`, placeholder `#999`). Content and plaza pagers follow the design strip: blue count in `共 N 项/个`, then `第 x 页 / y`, `上一页`, page buttons (active = white fill + `#237df5` border/text), `下一页`, and `跳至 [input] 页` (Enter submits; no 跳转 button). Content cards keep flat white chrome (`border #e8edf5`, `box-shadow: 0 3px 4px`). Folder sections stay transparent wrappers so the file mosaic reads as the design grid. Q&A keeps the three-column shell, one-column file list, and hidden file pager.

## Alternatives considered

**Bake the hero into KnowledgePage only.** Rejected; the design places the art in the shared FeaturePanel chrome that already owns the WANWEI Buddy / title / subtitle stack, and other features may reuse `headerArt`.

**Use the plaza book PNG as a full clickable image with baked Chinese copy.** Rejected; locale-owned product strings stay in `productText`, and the card must remain a real button with accessible name and subtitle.

**Inline SVG recreations of the hero and book.** Rejected; the design exports are the source of visual truth for 100% restoration.

## Consequences

Local source launches must stage the new covers into the served `apps/web/dist/knowledge-covers/` (or rebuild the product web assets) or the images 404 while layout still works. Panels without `headerArt` are unchanged.
