# Agent Note: Workbench public knowledge catalog design alignment

Status: implemented

English | [中文](2026-11-04-workbench-public-knowledge-catalog-design.zh.md)

## Problem

The management workbench category tabs (public and authorized library grids) already used banner cards and chrome actions, but the page head lacked the js.design decorative strip, the category toolbar still sat in a frosted plate, and the card more-menu lived in the title row instead of on the banner — so the public-tab frame still read as an earlier catalog.

## Decision

Align category-tab catalog chrome with the js.design public knowledge frame without changing category APIs, tab ownership (Personal plus each created category), or visibility rules. Stage `page-header-art.png` under `services/one-api/web/air/public/knowledge-icons/` and render it as right-aligned decorative art behind the page title. Flatten the category toolbar to a transparent search / sort / create row. Category-card marks and hue-matched banner plates resolve from library names as in [workbench authorized knowledge card name themes](2026-11-04-workbench-authorized-knowledge-card-themes.md); keep the first-tag subtitle and pin the admin more-menu to the banner's top-right. Personal-directory chrome and org → people browsing stay as in [workbench personal knowledge directory design](2026-11-04-workbench-personal-knowledge-directory-design.md).

## Alternatives considered

**Collapse categories into fixed 个人 / 授权 / 公开 tabs.** Rejected; product tabs remain Personal plus each created category, and the mock's 授权知识库 / 公开知识库 labels are example category names, not a new grouping model.

**Omit header art and approximate with CSS gradients only.** Rejected; the folder/document strip is the visual source for the public-tab page head, matching staged knowledge-icons cutouts elsewhere.

**Keep the frosted toolbar plate from the personal wash era.** Rejected; the public-tab frame shows a flat control row over the page wash.

## Consequences

Workbench builds must include `page-header-art.png` or the header image 404s while layout still works. Category create still uses the Lucide plus on the primary button; personal-directory create keeps `icon-new-library.png`.
