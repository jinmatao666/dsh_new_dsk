# Agent Note: Verified final deliverables

Status: implemented

English | [中文](2026-10-14-verified-final-deliverables.zh.md)

## Problem

Inferring final outputs from mutation logs can expose intermediate documents, duplicate relative and absolute paths, or omit files when the closing response names none. Automatic skill workspaces also need second-level timestamps to reduce name collisions.

## Decision

The private Host composition registers `deliver_files`. It resolves paths through the session filesystem, requires existing regular files and deduplicates filesystem identities. The complete list replaces earlier declarations in the same turn. A bounded turn-stopping reminder steers the model once after successful file or shell work without a later declaration.

The UI consumes declaration results from root tool calls. Empty or failed declarations clear the row. Without a declaration, current response-bearing history requires a resolvable closing reference rather than guessing all modified documents. Process files remain on disk. Automatic workspace names use local `YYYYMMDDHHmmss`; same-second collisions retain exclusive directory creation and numeric suffixes.

## Alternatives considered

**More filename heuristics:** scratch names and document extensions do not establish final intent and cannot canonicalize filesystem aliases.

**Unlimited finish retries:** repeated model omissions must not create an unbounded turn. The reminder is limited to one attempt.

## Consequences

File existence and identity are deterministic; final intent and document quality still depend on task execution and model selection. The model must call the tool directly, not through nested dispatch. Without a correct declaration or reference, the UI can omit a file rather than advertise an inferred intermediate file. Installed-desktop and live-model acceptance remain necessary.

## Testing

Focused Loader/filesystem tests cover existing files, aliases, missing files, directories, empty lists and disposal. Conversation fixtures cover declaration precedence, replacement, empty lists and live-append/replay agreement. Native filesystem tests cover fourteen-digit workspace allocation and collisions.
