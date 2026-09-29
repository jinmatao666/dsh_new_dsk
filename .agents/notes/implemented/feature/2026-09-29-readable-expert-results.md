# Agent Note: Readable expert results and user-selected downloads

Status: implemented

English | [中文](2026-09-29-readable-expert-results.zh.md)

## Problem

Document summaries expose Markdown table delimiters and internal source tags in narrow parallel sections. Automatic saving in Downloads leaves users unsure where their output resides.

## Decision

The independent document expert presents single-column chapters with readable type, semantic lists, emphasis and horizontally scrollable tables. Numeric source superscripts and source-file markers become readable references; arbitrary HTML remains escaped. Word export renders corresponding headings, lists, emphasis and tables. Regenerating a task is required to change an existing Word file.

All six websites forward authenticated output bytes to the desktop command. The native Save As dialog alone chooses the destination and confirms replacement. The command validates bounded bytes, names and unchanged supported extensions, returning a saved path or null on cancellation. Websites display the saved path and do not report cancellation as success.

## Alternatives considered

**Keep automatic Downloads saving.** This preserves fewer clicks but does not satisfy the explicit choice-of-location requirement.

**Activate arbitrary model HTML.** This preserves model formatting but exposes users to untrusted executable markup. A bounded escaped renderer supports the required report structures instead.

## Consequences

The meeting expert's active task page uses a CSS waiting animation and a one-second elapsed clock based on submission time. It does not infer backend stages or completion percentage. Queued wording is distinct, and navigation, expiry and terminal rendering stop the clock. Source filenames wrap and the sidebar uses larger text; reduced-motion preferences disable the animation.

Geology, third-survey and planning-review results use business names from their own field/layer maps, prominent conclusion and verification sections, evidence labels and collapsed technical identifiers. Original values, unknown codes and the complete model text remain intact. New model requests carry the terminology map and prohibit inventing units or grade meanings.

The blue-white design and expert navigation assets remain unchanged. Webpage deployment updates report presentation; the native picker requires an updated desktop build. OneAPI requires no change. Browser downloads retain browser behavior. Native dialog interaction on Windows, macOS and Linux remains a platform acceptance check.

## Verification

Frontend tests cover table and citation rendering, escaped script text, saved-path return and cancellation. Python tests inspect Word tables and emphasis. Rust tests exercise file validation and selected destinations; the desktop library compiles. Local browser screenshots check summary rendering and narrow-width overflow.
