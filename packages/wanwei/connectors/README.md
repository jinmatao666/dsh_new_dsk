---
description: "Display the independent Wanwei connector page with server-controlled entry visibility."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-connectors

English | [中文](README.zh.md)

## Summary

Users can browse connector categories and inspect demonstration dialogs. The DingTalk card connects personal DingTalk Workspace CLI (`dws`) auth and installs the `dws-cli` skill under `$DSH_HOME/skills`. The WeCom card connects official `@wecom/cli` auth and installs `wecomcli-*` skills under the same home. The WeChat Assistant card binds personal WeChat through Tencent iLink QR (in-app modal) and runs an inbound chat bridge so phone messages drive desktop Sessions with replies returned to WeChat. System Settings controls the page entry for Internet and intranet deployments; the default enables Internet and hides intranet.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Wanwei desktop product mounts this plugin through its [composition patch](../../bundle/wanwei-desktop/cordis.patch.yml). It has no per-plugin configuration fields.

DingTalk on the connectors page means personal DWS authorization plus the `dws-cli` skill for desktop agent use (calendar, AI tables, docs, mail, todos, and related products). The product ships `dingtalk-workspace-cli` (`dws`) and stages `app/assets/dws-cli` in the desktop runtime. **连接** starts `dws auth login` (browser OAuth / QR, typically returning to `127.0.0.1`) outside the WebView request, polls Host status until a lock-free `dws auth status --readonly` reports a saved login (even while `dws auth login` is still running) and then installs the skill from staged assets (or `@dingtalk-real-ai/dsh-dingtalk`); if auth already succeeded, it only writes the skill. **解绑** removes the local skill copy and returns before any CLI process; DingTalk logout continues in the background, and WeCom unbind does not spawn `wecom-cli`. A later **连接** also returns before that CLI starts. A dropped localhost request stays on that connector card; the connector directory and the expert catalog retry the local service instead of remaining on the service-unavailable page. WeCom means the product-bundled `wecom-cli` QR auth (`auth init --noninteractive`, started without a prior `auth show`); the Host observes the stable `~/.config/wecom/credentials.enc`, installs the official `wecomcli-*` skills from `app/assets/wecom-skills` into `$DSH_HOME/skills`, and reports connected without waiting for init to exit by itself (packaged Hosts do not download skills from GitHub at connect time). WeChat Assistant means iLink QR bind (`loginStart` / `loginPoll`) with credentials under `$DSH_HOME/wechat-assistant` and a Host `getupdates` bridge that prompts a desktop Session and `sendmessage`s the reply. **去试试** stages an example prompt in the main composer, selects that connector on the blue `conversation.composer.tools` chip next to `+`, and auto-prepares a Workspace Session on first send (no workspace picker required). DingTalk/WeCom **解绑** clears CLI credentials and skill copies; WeChat **取消连接** clears iLink credentials and stops the bridge. The product keeps `@dingtalk-real-ai/dsh-dingtalk` only as the `dws-cli` asset source; it does not mount DingTalk Stream IM or collect robot Client ID / Secret. Other connector rows remain demonstrations.

The Client currently omits WeCom from the connector directory and composer picker and does not probe its status. Its Host RPC and packaged CLI/skill assets remain mounted.

Opening the page checks the configured platform through the deployment refresh RPC in either network mode. A failed request shows a disconnected-plug placeholder; a successful check displays the local demonstration directory. Reopening the page checks again. This checks platform reachability, not third-party connector health or authorization. Administrator entry visibility still applies.

Disable this plugin's row to remove its entry; do not disable another business plugin as a substitute. Shared authentication, renderer and sidebar services remain provider-owned.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client owns its connector list, selection and dialogs. DingTalk detail uses Host RPC `/wanwei-dingtalk`; WeCom uses `/wanwei-wecom` (`status`, `login`, `installSkill`, `disconnect`); WeChat Assistant uses `/wanwei-wechat` (`status`, `loginStart`, `loginPoll`, `disconnect`). Secrets stay inside each CLI or iLink credential store; the Client only receives non-secret status and QR image data URLs. Status probes are cached briefly on Host and the Client paints from the last known status so「已连接」/「去试试」appear immediately on reopen.

The [Client entry](src/client/index.ts) supplies the UI. The [Host entry](src/index.ts) registers the connector RPC channels.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Product composition](../../bundle/wanwei-desktop/README.md) — profile ownership.
- [Authentication and network policy](../oneapi-auth/README.md) — shared services.
- [Independent page decision](../../../.agents/notes/implemented/architecture/2026-10-10-independent-wanwei-pages.md) — lifecycle and dependency rationale.
- [Desktop DWS skills](../../../.agents/notes/implemented/feature/2026-10-16-wanwei-dingtalk-desktop-dws-skills.md) — why personal DWS auth is the DingTalk connectors success path.
- [Desktop WeCom CLI skills](../../../.agents/notes/implemented/feature/2026-10-19-wanwei-wecom-desktop-cli-skills.md) — WeCom wecom-cli auth + skills path.
- [WeChat Assistant iLink channel](../../../.agents/notes/implemented/feature/2026-10-19-wanwei-wechat-assistant-ilink.md) — personal WeChat inbound remote channel.

-----

<a id="model-experience"></a>
## Model Experience

None from the Client presentation itself (it registers no prompt or tools). After DingTalk/WeCom connect, desktop sessions discover `dws-cli` and/or `wecomcli-*` through skill-filesystem. After WeChat Assistant connect, inbound WeChat text creates ordinary desktop Sessions through `sessionController`, so model/token use follows those Sessions.

#### KV Cache effect

No direct changes to model context or cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Apart from the DingTalk DWS, WeCom wecom-cli, and WeChat Assistant iLink paths, remaining catalog rows stay demonstrations without real authorization or service execution.
- DingTalk and WeCom both ship their CLIs inside the desktop `prepare:runtime` closure (WorkBuddy-style); PATH / `npm -g` is only a fallback.
- WeChat Assistant v1 handles direct text (and voice transcript) only; media and group chats are deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
