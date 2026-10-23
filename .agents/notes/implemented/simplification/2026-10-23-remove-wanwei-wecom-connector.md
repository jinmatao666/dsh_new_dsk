# Agent Note: Remove the Wanwei WeCom connector

Status: implemented

English | [中文](2026-10-23-remove-wanwei-wecom-connector.zh.md)

## Problem

The Wanwei connectors package still carried a full WeCom (`企业微信`) path: Host `/wanwei-wecom` RPC, Client panel and catalog row (already hidden), `@wecom/cli` desktop packaging, and `wecomcli-*` skill staging. The product no longer offers that connector; keeping the dead path forced installer downloads, optional native binaries, and Host/Client surface that nothing in the UI could use.

## Decision

Delete the WeCom connector end-to-end. Remove Host `wecom-cli` helpers and `/wanwei-wecom` registration, Client WeCom panel/API/status cache/locale keys/catalog row, WeCom-only tests, `wecom.png`, `ensure:wecom-skills`, `prepare:runtime` WeCom staging, Tauri skill copy / `DSH_WECOM_SKILLS_DIR`, and `@wecom/cli` / platform optionalDependencies from the desktop product and runtime closure. DingTalk DWS and WeChat Assistant iLink remain the live connector channels.

This consolidates and replaces the former Desktop WeCom CLI skills Agent Note (deleted in the same change). That note’s original motivation was WorkBuddy-style「连接」plus official CLI skills without a separate `npm install -g`; product direction no longer justifies that surface, so the capability is given up rather than kept dormant behind a hidden Client filter.

## Alternatives considered

**Keep Host RPC and packaged CLI while the Client stays hidden.** Rejected: it still bloated installers and maintained unused auth/skill code with no product entry.

**Leave WeCom as a demonstration catalog card only.** Rejected: the card already implied a real channel, and half-implemented packaging was the costly part.

## Consequences

Desktop builds no longer download WeCom skills or ship `@wecom/cli`. Users who previously authorized wecom-cli on a machine keep local `~/.config/wecom` credentials until they clear them manually; the product no longer reads or installs `wecomcli-*` under `$DSH_HOME/skills`. Reintroduction would need a new feature decision and fresh packaging. Connector package tests assert the directory has no「企业微信」row. Third-party notices drop `@wecom/cli*`.
