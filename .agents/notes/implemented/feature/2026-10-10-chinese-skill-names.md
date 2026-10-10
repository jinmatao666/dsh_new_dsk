# Agent Note: Skill display names and duplicate installation rejection

Status: implemented

English | [中文](2026-10-10-chinese-skill-names.zh.md)

## Problem

The slash menu exposed internal identifiers instead of market names. Personal imports could also create indistinguishable display names or replace an installed directory. The split Wanwei pages must not own the runtime name lookup.

## Decision

Keep `name` as the stable identifier and propagate optional `displayName` through filesystem discovery, the registry, the session RPC, and the slash menu. Generic installed display records and platform manifests supply labels without requiring a marketplace visit; product-specific receipts stay in the desktop installer. Chips display Chinese labels while submitting canonical identifiers; direct unique display-name aliases resolve at the user invocation boundary.

The desktop installer serializes platform, SkillHub, and personal installation checks through one lock. It rejects duplicate display names across the installed user skill root, comparing collapsed whitespace and lowercase text. A platform or SkillHub update may retain its own target identity; personal imports never replace existing targets. New display records persist alongside installed files.

## Alternatives considered

**Rename canonical identifiers to Chinese.** Rejected because identifiers address files, tools, and persisted references; a label need not alter identity.

**Append source suffixes to duplicate labels.** Rejected because the user explicitly requested refusal of duplicate additions rather than generated disambiguation.

## Consequences

Missing labels fall back to identifiers; the implementation does not translate arbitrary English names. Existing duplicate aliases are not automatically executed through a hand-typed display name. Project skill roots and remote uninstalled catalog entries are outside desktop installation uniqueness checks. The four page plugins remain independent. OneAPI and the six expert containers are unchanged; desktop distribution requires a rebuilt installer and platform acceptance.

## Verification

Focused tests cover label propagation, Chinese search and invocation, ambiguous aliases, and refusal of a personal import that duplicates a platform label while preserving the original instructions. Native tests also allow an identity-preserving platform update. Windows symlink tests require privileges unavailable in this local test environment.
