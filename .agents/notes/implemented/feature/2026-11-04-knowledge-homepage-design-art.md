# Agent Note: Knowledge homepage design art

Status: implemented

English | [中文](2026-11-04-knowledge-homepage-design-art.zh.md)

## Problem

The desktop Knowledge homepage FeaturePanel header showed only the WANWEI Buddy kicker, title, and subtitle, so it did not match the product design's right-side glassmorphism hero. The sidebar plaza entry used a generic SVG house icon on a flat blue card, and the selected-library header used an inline SVG folder instead of the staged product folder mark.

## Decision

`FeaturePanel` accepts optional `headerArt` (absolute URL). Knowledge registers `/knowledge-covers/hero-banner.png`, which the header shows at a fixed **185px** height, right-aligned, with `object-fit: contain`. The shipped PNG is a 2× raster (3280×370) derived from the design-height `plaza-bg-top.png` (1640×185); chat-compressed 1024×115 previews must not replace it. Product assets live under `products/wanwei-desktop/assets/web/knowledge-covers/`. The plaza launch uses the js.design plate `plaza-entry.png` as a full-bleed background with locale-owned copy and `icon-plaza-launch-arrow.png`. Library artwork uses the stored cover first, the personal-library PNG second, and the layered-book SVG with a globe or bookmark for other libraries without a cover. PDF and clock icons retain the staged design cutouts; empty library descriptions are omitted.

The sidebar groups use 32px rounded trapezoid tabs in indigo, teal, and violet, with a continuous bottom rule when collapsed. The file panel uses a matching low tab and shares its selected group palette with the sidebar chat icons. Each sidebar card retains its cover, title, expandable details, chat button, and the four library statistics. File content uses a responsive card grid with small thumbnails and the existing metadata and actions; Q&A mode switches files and folders to a single column. The selected-library strip stays compact. Plaza cards have equal dimensions, unfiltered cover photos, readable status badges, and separate red like buttons. Search, sorting, folder navigation, upload actions, subscriptions, and pagination keep their existing handlers. Q&A retains its existing rendering and behavior, including the hidden file pager in chat mode.

Base `.dsh-knowledge-file-icon` sizes and clips PDF/Word images at 30×30 with `object-fit: contain` and `overflow: hidden`, so preview-ask file chips cannot paint the native 2–3× pixels. Thumbnail rows use their own smaller file badge. Content and plaza pagers retain the page count, numbered navigation, previous/next buttons, and Enter-to-submit page input.

## Alternatives considered

**Bake the hero into KnowledgePage only.** Rejected; the design places the art in the shared FeaturePanel chrome that already owns the WANWEI Buddy / title / subtitle stack, and other features may reuse `headerArt`.

**Use the plaza book PNG as a full clickable image with baked Chinese copy.** Rejected; locale-owned product strings stay in `productText`, and the card must remain a real button with accessible name and subtitle.

**Inline SVG recreations of the hero and book.** Rejected; the design exports are the source of visual truth for 100% restoration.

## Consequences

The local `scripts/start-wanwei.ps1` stages product Web artwork into the served `apps/web/dist/` before checking or starting services, including when reusing a running desktop. `stage-web-assets.mjs` restores missing assets and replaces stale artwork while preserving compiled frontend files. Other source launchers must stage product assets or use the product Web build; an official Web build alone does not contain private artwork. Panels without `headerArt` are unchanged.
