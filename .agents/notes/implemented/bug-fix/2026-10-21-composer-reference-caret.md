# Agent Note: Composer reference caret spacing

Status: implemented

English | [中文](2026-10-21-composer-reference-caret.zh.md)

## Problem

Inline reference capsules contain non-editable icons and interactive skill buttons. An inline host without its own box allows caret painting to intersect the capsule. A following text separator creates two neighboring arrow stops, while an absolutely positioned removal badge extends into nearby references.

## Decision

The [reference host](../../../../packages/client/ui-conversation/src/client/input/editor/chip-node.tsx) is an inline block with three pixels of horizontal padding on each side. The skill removal button participates in the capsule's flex layout; the staged skill prefix follows the same rule. Both reserve visual space without adding text or editable nodes.

The [keymap](../../../../packages/client/ui-conversation/src/client/input/editor/keymap.ts) moves a collapsed caret across one reference and its single following ASCII space in one unmodified horizontal-arrow gesture. Repeated spaces, selection gestures, modified arrows and composition pass through. Clipboard text, occurrence identity and submission codecs are unchanged.

## Alternatives considered

**Delete separating spaces.** This joins reference tokens to following text in persisted drafts and clipboard output. Keeping the text separator preserves those representations without introducing another node type.

**Only add margins.** Margins do not remove duplicate arrow stops, and an out-of-flow badge still has no reserved width. An atomic host box plus an in-flow button addresses both geometry and navigation.

## Consequences

Skill capsules reserve additional width for their removal button, so long labels truncate earlier. Keyboard users retain visible button focus. Focused editor tests cover navigation and unchanged text; browser checks cover caret boundaries, typing, deletion, capsule spacing and narrow-screen wrapping. The change adds no model-visible content or network requests.
