# Agent Note: Knowledge content pane default leaves room for Q&A

Status: implemented

English | [中文](2026-10-30-knowledge-content-width-default.zh.md)

## Problem

The desktop knowledge page opens with a 400px middle content pane. On typical skill-market widths that column plus the 224px sidebar leaves the right-hand Q&A pane cramped. Resize math also used a 210px sidebar allowance while CSS reserved 224px, so dragging the divider could grow content past the intended chat floor.

## Decision

`CONTENT_DEFAULT` is 280px and the CSS `--dsh-knowledge-content-width` fallback matches. `CHAT_MIN` is 280px (240px under the 980px media query) so the grid and `contentSpan` keep a usable Q&A track. `contentSpan` uses `NAV_DESKTOP` 224 / `NAV_NARROW` 180 — the same tracks as `.dsh-knowledge` — when computing the content max and pointer-relative width. Users can still widen the content pane with the divider up to that max.

## Alternatives considered

Keep 400px and only raise the chat floor — rejected; the reported failure is the first-open balance, not drag limits alone. Drop the content default to `CONTENT_MIN` (260px) — rejected; the document list still needs room for names and toolbar actions without forcing every user to drag wider.

## Consequences

Fresh opens give Q&A roughly 120px more than before at the same shell width. Dragging still overrides the default within `[CONTENT_MIN, contentSpan.max]`. The divider test pins width from `clientX − NAV_DESKTOP`.
