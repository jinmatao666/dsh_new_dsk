# Agent Note: Composer reference caret spacing

Status: implemented

English | [中文](2026-10-21-composer-reference-caret.zh.md)

## Problem

Inline reference capsules contain non-editable icons and interactive skill buttons. An inline host without its own box allows caret painting to intersect the capsule. A following text separator creates two neighboring arrow stops, while an absolutely positioned removal badge extends into nearby references.

## Decision

The [reference host](../../../../packages/client/ui-conversation/src/client/input/editor/chip-node.tsx) is an inline block with three pixels of horizontal padding on each side; skill hosts reserve additional leading and trailing space around the capsule and removal badge. Reference layout reserves visual space without adding text or editable nodes.

The [keymap](../../../../packages/client/ui-conversation/src/client/input/editor/keymap.ts) moves a collapsed caret across one reference and its single following ASCII space in one unmodified horizontal-arrow gesture. Repeated spaces, selection gestures, modified arrows and composition pass through. Clipboard text, occurrence identity and submission codecs are unchanged.

Unmodified outward arrows stop at the ends of a document containing references instead of entering WebKit's auxiliary decorator DOM. The [caret binding](../../../../packages/client/ui-conversation/src/client/input/editor/chip-caret.ts) paints a CSS caret for focused, collapsed element-point selections beside reference hosts. Native text carets remain unchanged; blur, range selection, read-only state, root replacement and disposal clear the decoration. WebKit's managed line-break image retains its DOM identity with zero dimensions and opacity, suppressing broken-image painting without changing editor text.

The pre-Session draft uses a local editor built by the same document factory as the Session shell. Both register the same plain-text commands, history and reference keymap. The draft-prefix owner settles the leading token into a reference inside that document; no product-rendered prefix sits outside its editable root. Serialized draft echoes leave the editor nodes and selection intact. This gives Use skill the same caret behavior without allocating a Workspace or Session before send.

Draft-safe source variants run through the same trigger controller with an explicitly absent Session projection and an editor mutation callback. Skill completion reads the root catalog; file completion browses one home directory at a time and stores absolute paths. This separates editing from persistent allocation: neither candidate lookup nor reference removal selects or creates a Workspace. Structured reference occurrences transfer with the staged text, preserving source identities and labels when a user chooses a Workspace manually. Session-only commands are not presented as draft-safe operations.

## Alternatives considered

**Delete separating spaces.** This joins reference tokens to following text in persisted drafts and clipboard output. Keeping the text separator preserves those representations without introducing another node type.

**Only add margins.** Margins do not remove duplicate arrow stops, and an out-of-flow badge still has no reserved width. An atomic host box plus an in-flow button addresses both geometry and navigation.

**Insert invisible text anchors.** Extra characters create editable positions and must be stripped from clipboard, persistence and submission. A DOM-only caret decoration avoids changing those representations.

## Consequences

Skill capsules reserve additional width for their removal button, so long labels truncate earlier. Keyboard users retain visible button focus. Focused editor tests cover navigation, caret-decoration cleanup and unchanged text; Chromium and WebKit checks cover repeated outward arrows, both reference types, typing and deletion. macOS WKWebView release acceptance remains required because Windows-hosted WebKit does not reproduce every native caret-painting defect. The change adds no model-visible content or network requests.
