# Agent Note: Wanwei WeCom connector means desktop wecom-cli skills

Status: implemented

English | [中文](2026-10-19-wanwei-wecom-desktop-cli-skills.zh.md)

## Problem

The connectors catalog listed WeCom as a demonstration card. Product users expect the WorkBuddy loop: click **连接**, scan once, then use WeCom skills in desktop chat — without a separate `npm install -g @wecom/cli` step.

## Decision

The connectors WeCom card’s primary “已连接” state is **wecom-cli authorization + the official `wecomcli-*` skills installed under `$DSH_HOME/skills`**, discovered by skill-filesystem for desktop sessions. Host RPC `/wanwei-wecom` exposes `status` / `login` (`wecom-cli auth init --noninteractive`) / `installSkill` / `disconnect`.

The desktop product **ships `@wecom/cli` (platform optional binary) inside `prepare:runtime`** and stages Agent Skills under `runtime/app/assets/wecom-skills`. Host resolution prefers the bundled binary (`DSH_WECOM_CLI` / next to `DSH_NODE_BINARY` / product `node_modules`) before PATH. Skill install prefers the staged assets and downloads from GitHub only as a development fallback. Bot ID / Secret never appear in the connectors UI.

This mirrors WorkBuddy’s “open the app and connect” UX while reusing the official CLI QR flow (`source=wecom_cli_external`).

## Alternatives considered

**Require operators to `npm install -g @wecom/cli`:** rejected for product UX; WorkBuddy does not ask end users to install the CLI separately.

**Hand-roll WeCom OpenAPI in wanwei/connectors:** rejected because the official CLI already owns QR bind, encrypted credentials, and Agent Skills.

**Treat Stream/webhook robot wiring as “已连接”:** rejected for the desktop skill ask.

## Consequences

Installer / `prepare:runtime` builds must include the current-platform `@wecom/cli-*` optional package and staged skills under `app/assets/wecom-skills` (network required at build time for the skills tarball). Packaged Hosts resolve skills via `DSH_WECOM_SKILLS_DIR` / `DSH_APP_ROOT` / `DSH_NODE_BINARY` → `app/assets/wecom-skills` and refuse a connect-time GitHub download in that packaged context, so intranet installs do not surface raw `Failed to fetch`. When auth already succeeded but skills are missing, **连接** installs skills without reopening QR. Until QR auth succeeds and skills are copied under `$DSH_HOME/skills`, desktop prompts that need WeCom APIs cannot run through those skills.

「去试试」stages the example prompt and selects WeCom on the resident `conversation.composer.tools` chip next to `+`, matching the DingTalk chip behavior.

Personal WeChat inbound chat is a separate connectors card; see [WeChat Assistant iLink channel](2026-10-19-wanwei-wechat-assistant-ilink.md).
