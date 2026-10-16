# Agent Note: Skill reference details and examples

Status: implemented

English | [中文](2026-10-16-skill-reference-details.zh.md)

## Problem

Staged skill labels removed the reference when clicked, while Session editor chips had no removal control. Administrators could not provide usage examples for the desktop detail page.

## Decision

Use separate name and top-right removal buttons in both states. The editor emits the typed browser event `dsh:reference-open` carrying source/ref; the marketplace owns navigation and resolves platform, personal and current-Session local metadata. Closing details retains the draft. Removal deletes one reference occurrence, never installed files. The OneAPI service supplies `usage_example` through skill metadata; the desktop renders escaped plain text with preserved line breaks below the description, hiding empty examples.

## Alternatives considered

Opening details from the whole chip while also using the whole chip for deletion makes the actions ambiguous. Embedding marketplace navigation in the generic editor would couple independent feature plugins. Reading examples from executable SKILL.md would mix user-facing examples with model instructions and require package changes for simple metadata edits.

## Consequences

Focused tests exercise separate actions before Workspace selection and real Lexical removal after selection, preserving text and other references. The desktop CLI profile browser regression checks server-provided examples and staged navigation/removal using only external backend/native fixtures. The OneAPI DTO test passes; its SQLite persistence test requires CGO unavailable in the current Windows shell. Both backend and desktop must be updated for example display. No model prompt or reference serialization changes.
