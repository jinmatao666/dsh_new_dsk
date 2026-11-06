# Agent Note: Land market and policy encyclopedia entries

Status: implemented

English | [中文](2026-11-03-land-market-policy-encyclopedia-entries.zh.md)

## Problem

Administrators need two additional desktop entries—land market and policy encyclopedia—whose visibility follows the existing per-environment feature switches, while the embedded page address is configured separately. Without a dedicated configuration surface and desktop plugin, those portals cannot appear or update from the workbench.

## Decision

Extend `SystemDeploymentSettings.features` with `landMarket` and `policyEncyclopedia` booleans for internet and intranet. Missing values in older records default to hidden (`false`). Add `featurePages` with `{ landMarket, policyEncyclopedia }.url` http(s) addresses (empty allowed). Workbench System Settings → Feature Settings owns both visibility switches and URL editing: blue Address Configuration links beside land market and policy encyclopedia open the page-address dialog (the former Feature Configuration tab is removed). Public `/api/desktop-config` publishes both. Desktop package `@deepseek-ai/dsh-wanwei-portals` registers two feature panels that observe visibility and URL through `wanweiNetwork`, embed the page in an iframe with `headerChrome: 'back-only'` (no WANWEI Buddy / title / subtitle stack; floating back control only), and maximize the window on open via `maximize_expert_window`. While the iframe loads, `PortalPage` shows a full-panel spinner that matches knowledge-base `ViewerLoading` visuals (local CSS copy; no package dependency), clears it on the frame `load` event, and restores it when the configured URL changes.

## Alternatives considered

**Reuse expert native webviews:** Rejected for these entries because they do not need expert tickets and must accept arbitrary administrator URLs without the expert launch path.

**Single shared switch for both portals:** Rejected because administrators may enable only one portal per environment.

## Consequences

Workbench, OneAPI desktop-config parsing, and the Wanwei desktop profile must update together. Older desktops ignore the new flags until upgraded. Iframe-blocking sites stay blank until a later native embedding path exists; browsers that still fire `load` after a blocked embed clear the spinner and leave the blank frame. Focused workbench, Go, deployment, and Client tests cover defaults, validation, visibility, configured URLs, and the loading overlay lifecycle.
