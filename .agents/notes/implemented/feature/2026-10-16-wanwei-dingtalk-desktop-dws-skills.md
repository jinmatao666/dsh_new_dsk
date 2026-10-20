# Agent Note: Wanwei DingTalk connector means desktop DWS skills

Status: implemented

English | [中文](2026-10-16-wanwei-dingtalk-desktop-dws-skills.zh.md)

## Problem

Treating “DingTalk connected” as robot Stream registration (Client ID / Secret / app-registration QR) optimizes for chatting with a bot inside the DingTalk app. Product users expect the WorkBuddy loop: click **连接**, authorize once, then use DingTalk skills in desktop chat — without a separate `npm install -g dingtalk-workspace-cli` step.

## Decision

The connectors DingTalk card’s primary “已连接” state is **personal DWS auth + the `dws-cli` skill installed under `$DSH_HOME/skills`**, discovered by skill-filesystem for desktop sessions. Host RPC `/wanwei-dingtalk` exposes `status` / `login` (`dws auth login`) / `installSkill` / `disconnect` (removes the skill copy).

The desktop product **ships `dingtalk-workspace-cli` inside `prepare:runtime`** and extracts the native `vendor/dws[.exe]` (deploy ignores npm lifecycle scripts). Host resolution prefers the bundled binary (`DSH_DWS_CLI` / next to `DSH_NODE_BINARY` / product `node_modules`) before PATH. `products/wanwei-desktop` keeps `@dingtalk-real-ai/dsh-dingtalk` as an npm dependency **only** for the bundled `dws-cli` skill assets; the product profile does **not** mount that package for Stream IM, and connectors do not run app-registration QR or write `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET`.

This matches the WeCom bundling decision in [desktop WeCom CLI skills](2026-10-19-wanwei-wecom-desktop-cli-skills.md). It consolidates and replaces the removed robot scan-bind connectors path and the former profile Stream channel mount.

## Alternatives considered

**Require operators to `npm install -g dingtalk-workspace-cli`:** rejected for product UX; WorkBuddy-style connectors do not ask end users to install the CLI separately.

**Robot app-registration QR as the connect path (Client ID / Secret / Stream private chat):** rejected for the desktop skill ask; that flow creates bot credentials for chatting with a robot inside DingTalk, not personal DWS login for agent skill use. Product code, private-setup resume scripts, and profile Stream mounts for that path are removed.

**Ship `@michengai/dsh-im-connect` as the product IM layer:** rejected for peer/version mismatch with this repo’s alpha line.

**Keep mounting `@dingtalk-real-ai/dsh-dingtalk` on the product profile for Stream while connectors use DWS:** rejected; dual “connected” stories confuse operators, and desktop success is DWS skills only.

## Consequences

Installer / `prepare:runtime` builds must include `dingtalk-workspace-cli`, extract the current-platform `vendor/dws` binary, and stage `app/assets/dws-cli` skill assets so packaged Hosts resolve them via `DSH_DWS_SKILL_DIR` / `DSH_APP_ROOT` / `DSH_NODE_BINARY` without `require.resolve`. End users of a current installer only need to click **连接** and authorize. **连接** starts `dws auth login` in the Host process and returns `authorizing: true` immediately; the Client polls `status` until the CLI exits and then shows connected or the Host `authorizeError`. Holding the login RPC open for the whole browser round-trip makes the desktop WebView report `Failed to fetch` after focus returns from the system browser. When auth already succeeded but the skill is missing, **连接** installs the skill without reopening the OAuth browser. Until `dws auth login` succeeds and `dws-cli` is copied under the product home skills root, desktop prompts that need DingTalk APIs cannot run through the skill. Stream robot private-chat is out of product scope for this connectors card.

「去试试」stages the example prompt and selects DingTalk on the resident `conversation.composer.tools` chip (session-maybe, next to `+`), because `conversation.input.left` is session-scoped and disappears after `sessions.clear()`. The chip opens a picker to switch connectors or reopen the connectors panel.

Status probes spawn at most one `dws auth status` (bundle or PATH presence implies install; no separate `--version`), coalesce in-flight Host calls, and reuse a short TTL cache. The Client keeps the last status in memory/localStorage so the list badge and detail sheet paint「已连接」/「去试试」immediately, then soft-refresh in the background.

The connectors catalog stays a multi-column card grid. Disconnected cards show a trailing `+` (opens the connect sheet); connected DingTalk shows a green status dot and a try chip that stages the example prompt immediately without opening the sheet.
