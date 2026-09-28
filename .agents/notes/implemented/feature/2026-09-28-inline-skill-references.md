# Agent Note: Inline skill references

Status: implemented

English | [中文](2026-09-28-inline-skill-references.zh.md)

## Problem

A separate skill banner duplicates the slash token above the question and consumes a full composer row. Market navigation and menu selection need the same compact presentation without changing host-side skill loading.

## Decision

Skill menu picks use atomic references whose codec emits the original slash token. The generic draft-prefix slot renders staged prefixes inline and settles plain leading text into Session references. Wanwei owns friendly-name lookup and capsule styling; shared primitives provide a skill glyph.

## Alternatives considered

**Restyle the separate banner only.** The slash token remains duplicated and the question still occupies another row.

**Remove the slash token from submitted messages.** Host-side loading needs the token; presentation must not change execution.

## Consequences

Questions remain editable beside the staged skill, and Session references serialize as `/name`. Manual tokens retain their text decoration unless a product presenter recognizes them. Skill chip display is local to the editor; persisted draft text can restore through the product presenter. Official modules contain no product names, storage keys or theme rules.

## Verification

Focused composer tests cover prefix settlement, staged question edits and submitted slash tokens. Product tests cover SVG labels, removal without navigation and the Session handoff. Visual comparison in the running desktop remains a manual check.
