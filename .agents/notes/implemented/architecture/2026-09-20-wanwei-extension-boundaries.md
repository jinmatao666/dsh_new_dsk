# Agent Note: Wanwei extension boundaries

Status: implemented

English | [中文](2026-09-20-wanwei-extension-boundaries.zh.md)

## Problem

Private business protocols and desktop commands inside official DSH components make upstream updates require repeated product migrations. Moving files alone does not remove that dependency.

## Decision

The official browser packages expose product-neutral platform-action and deliverable-extension registries. Product shells register native directory opening, native file saving, additional artifact parsers, and artifact presenters through those registries.

Wanwei owns the Tauri command mapping, `WANWEI_RESULT` parsing, analysis presentation, OneAPI vision provider, and skill marketplace. Those implementations live under `packages/wanwei` and enter the application only through the Wanwei bundle.

This arrangement keeps the official Workspace, Session export, and Deliverables packages usable without a desktop provider. A missing provider removes the optional action or falls back to browser downloading. It also leaves official runtime artifact detection independent of private wire markers.

Private product packages declare `dsh.release: false` and `private: true`, without `publishConfig`. Generic workspace and release checks exclude these packages from official release families and reject dependencies from published official packages into the private layer. No product-name allowlist defines this boundary.

## Alternatives considered

**Keep private behavior in official components.** This retains direct access to component internals but makes upstream component updates depend on Wanwei business protocols and desktop command mappings.

**Require zero official modifications.** This avoids a compatibility patch list but can force unsupported integration or remove existing behavior. Generic extension points are retained when the official component lacks a supported registration mechanism.

## Consequences

Upstream updates must preserve the two generic registries or replace them with equivalent upstream extension points. Product protocol and native-command changes remain in the Wanwei packages. Maintainers still review the small set of generic official modifications; the separation does not promise conflict-free upstream upgrades.
