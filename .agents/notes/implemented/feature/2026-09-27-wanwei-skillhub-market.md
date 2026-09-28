# Agent Note: SkillHub in the Wanwei skill market

Status: implemented

English | [中文](2026-09-27-wanwei-skillhub-market.zh.md)

## Problem

Users need public third-party skills alongside platform skills without mixing sources, overwriting local skills, or coupling the official harness to a remote marketplace.

## Decision

The Wanwei SkillHub plugin owns public catalog, icon and pinned archive requests. The existing product market displays it as a sibling section using scoped styles and controlled Markdown. Platform recommendations include only official platform entries; each catalog owns its search. SkillHub cards share the platform card anatomy and open a full detail page that preserves list position. The Host proxies bounded raster icons only from Tencent's image hostname. The desktop stages imports, writes a source receipt before publishing the directory, and refuses same-name installs from another source. Manual updates require the same remote identity and local receipt, with the previous version retained until replacement succeeds. Local receipts support offline listing and removal; invocation uses the actual installed name.

## Alternatives considered

**Embedding the upstream website** would import a separate navigation and styling model and would not integrate local installation state. Direct API adaptation preserves the existing market.

**Reusing OneAPI authentication for SkillHub** would couple independent upstreams. A separate product plugin keeps availability and protocol ownership independent.

## Consequences

The official agent loop remains unchanged. The delivery includes the generic staged-draft and draft-prefix client extension needed by skill invocation; no SkillHub business logic enters those contracts. Root workspace metadata registers the new product package. Platform installer ownership checks now reject SkillHub receipts, including the legacy name-only path. Paid skills, automatic updates and automatic dependency provisioning remain outside this feature. Icons from other hosts use a fallback glyph. API commercial terms and future credential requirements must be confirmed before production rollout.

[Product boundary decision](../architecture/2026-09-20-wanwei-extension-boundaries.md) remains active; this feature adds a product data source without superseding that decision.

Product brand occupants use priority -100 to coexist with the official brand plugin; equal default priorities prevent the assembled market from loading.
