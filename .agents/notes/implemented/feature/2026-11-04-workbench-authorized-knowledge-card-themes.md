# Agent Note: Workbench authorized knowledge card name themes

Status: implemented

English | [中文](2026-11-04-workbench-authorized-knowledge-card-themes.zh.md)

## Problem

Authorized-category library cards in the management workbench used one fixed banner plate and a single default mark (or an uploaded cover). The js.design authorized frame assigns each design-name library a specific squircle mark and a banner wash whose hue follows the mark, and vertically centers the mark with the title block.

## Decision

Resolve category-card mark and banner from the library name in `services/one-api/web/air/src/pages/Knowledge/index.js`. When the name contains a design keyword, use that keyword's staged mark under `public/knowledge-icons/icon-theme-*.png` and the hue-matched banner:

| Mark hue | Banner asset |
|---|---|
| Green (占补平衡 / 占卜平衡 / 占比平衡) | `card-banner-mint.png` (图4) |
| Yellow / coral (土地征收, 地灾防治) | `card-banner-pink.png` (图3) |
| Blue family (闲置土地, 土地市场, 耕地保护, 规划实施, 规划评估, 临时用地, 低效用地) | `card-banner-blue.png` |

Keywords and marks: 占补/占卜/占比平衡 → grid, 闲置土地 → clock, 土地征收 → zheng, 土地市场 → layout, 地灾防治 → landslide, 耕地保护 → seedling, 规划实施 → draft, 规划评估 → edit, 临时用地 → schedule, 低效用地 → gear. Names that match no keyword keep the default mark on the blue banner; an uploaded cover still replaces only that unmatched mark. Card header overlays the banner plate and vertically centers the mark with the title block. Page-head art and toolbar chrome stay as in [workbench public knowledge catalog design](2026-11-04-workbench-public-knowledge-catalog-design.md).

## Alternatives considered

**Keep one shared `card-banner.png` for every card.** Rejected; the design wash set is four hue plates paired to mark color, not a single plate.

**Cycle the four banners by card index.** Rejected; the same design name must keep the same plate across pages and sorts.

**Prefer uploaded covers over design-keyword marks.** Rejected; design-name libraries must show the specified mark even when a cover was stored earlier.

## Consequences

Air builds must ship the ten `icon-theme-*.png` marks and four `card-banner-*.png` plates or themed cards 404 while layout still works. Partial name matches (for example `规划编制`) do not take a 规划* theme unless the full keyword appears.
