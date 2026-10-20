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

Installer / `prepare:runtime` builds must include the current-platform `@wecom/cli-*` optional package and staged skills under `app/assets/wecom-skills` (network required at build time for the skills tarball). `tauri dev` runs `ensure:wecom-skills` into `products/wanwei-desktop/assets/wecom-skills` and sets `DSH_WECOM_SKILLS_DIR` when present; `DSH_DESKTOP_DEVELOPMENT=1` still allows a connect-time GitHub skill fallback. Packaged Hosts resolve skills via `DSH_WECOM_SKILLS_DIR` / `DSH_APP_ROOT` / `DSH_NODE_BINARY` → `app/assets/wecom-skills` and refuse a connect-time GitHub download, so intranet installs do not surface raw `Failed to fetch`. **连接** starts `wecom-cli auth init --noninteractive` (browser QR) immediately and does not run `auth show` first, because that probe can hang and the browser never opens. The call returns `authorizing: true` before the process starts; the Host watches the stable `<config_dir>/credentials.enc` written after QR authorization, installs the skills, stops the init process, and publishes connected status without waiting for that process to exit by itself. The default config directory is `~/.config/wecom` on every supported platform; `WECOM_CLI_CONFIG_DIR` overrides it. Holding the login RPC open for the QR round-trip makes the desktop WebView report `Failed to fetch` after focus returns from the system browser. **解绑** clears credentials and skill copies without spawning `wecom-cli`, so that request does not wait on `auth show`. A following **连接** returns `authorizing: true` before `auth init` starts. The connector directory and expert catalog retry a dropped localhost check instead of staying on the service-unavailable page. **连接** always starts that QR process, including while an `auth show` probe is still running. The probe does not open the browser and is stopped first so it cannot keep the CLI lock. The desktop shell also copies `app/assets/dws-cli` and `app/assets/wecom-skills` into `$DSH_HOME/skills` before the sidecar starts. Until QR auth succeeds and skills are copied, desktop prompts that need WeCom APIs cannot run through those skills.

「去试试」stages the example prompt and selects WeCom on the resident `conversation.composer.tools` chip next to `+`, matching the DingTalk chip behavior.

Personal WeChat inbound chat is a separate connectors card; see [WeChat Assistant iLink channel](2026-10-19-wanwei-wechat-assistant-ilink.md).
