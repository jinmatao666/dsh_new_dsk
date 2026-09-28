# Agent Note: SkillHub in the Wanwei skill market

Status: implemented

English | [中文](2026-09-27-wanwei-skillhub-market.zh.md)

## Problem

Users need public third-party skills alongside platform skills without mixing sources, overwriting local skills, or coupling the official harness to a remote marketplace.

## Decision

The Wanwei SkillHub plugin owns public catalog, icon and pinned archive requests. The existing product market displays it as a sibling section using scoped styles and controlled Markdown. Platform recommendations include only official platform entries; each catalog owns its search. SkillHub cards share the platform card anatomy and open a full detail page that preserves list position. The Host proxies bounded raster icons only from Tencent's image hostname. The desktop stages imports, writes a source receipt before publishing the directory, and refuses same-name installs from another source. Manual updates require the same remote identity and local receipt, with the previous version retained until replacement succeeds. Local receipts support offline listing and removal; invocation uses the actual installed name.

Each catalog has independent search, category, sort and twelve-card pages. Pagination stays beside that catalog's filters rather than below the combined market, so users do not mistake it for whole-page navigation. A shared toolbar and download glyph keep both sources visually consistent; the section heading identifies SkillHub without repeating its name on every card. Platform update ordering uses server timestamps, not inferred version dates.

The shared toolbar exposes first, last and nearby page choices plus a validated direct jump. It restores the market panel's scroll offset during filter or page changes; SkillHub retains the previous grid while the next remote page loads so transient height loss does not move the viewport.

My installations uses one source-filtered twelve-card page across platform/local entries and SkillHub receipts. One toolbar owns search and page state, so choosing all skills does not render two independently paginated lists. A matching platform entry and SkillHub receipt collapse into one card in the combined view; source filtering still exposes each installation. Native catalog changes refresh both installation sources, and receipt refreshes recalculate the page count after uninstall without querying SkillHub.

## Alternatives considered

**Embedding the upstream website** would import a separate navigation and styling model and would not integrate local installation state. Direct API adaptation preserves the existing market.

**Reusing OneAPI authentication for SkillHub** would couple independent upstreams. A separate product plugin keeps availability and protocol ownership independent.

## Consequences

SkillHub result feedback does not wait for receipt refresh. Progress notices stay visible until a result replaces them, while success and error notices expire. Both sources use neutral white notices with OS sans-serif text and concise result labels; only the status icon carries a semantic color. Receipt refresh failure remains distinct from installation or removal failure.

The official agent loop remains unchanged. The delivery includes the generic staged-draft and draft-prefix client extension needed by skill invocation; no SkillHub business logic enters those contracts. Root workspace metadata registers the new product package. Platform installer ownership checks now reject SkillHub receipts, including the legacy name-only path. Paid skills, automatic updates and automatic dependency provisioning remain outside this feature. Icons from other hosts use a fallback glyph. API commercial terms and future credential requirements must be confirmed before production rollout.

[Product boundary decision](../architecture/2026-09-20-wanwei-extension-boundaries.md) remains active; this feature adds a product data source without superseding that decision.

Product brand occupants use priority -100 to coexist with the official brand plugin; equal default priorities prevent the assembled market from loading.
