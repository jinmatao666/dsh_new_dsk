---
description: "Display the independent Wanwei connector page with server-controlled entry visibility."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-connectors

English | [中文](README.zh.md)

## Summary

The Feishu panel offers three clickable examples. Clicking stages an editable draft in a new conversation; it does not bind or open a phone-channel Session, create a workspace, or execute the request. The first explicit send allocates a separate workspace and Session. Desktop example entry does not require the optional inbound phone bridge to be ready; actual business requests still check authorization.

Recommended login permissions include optional business capabilities. Missing recommended permissions do not block the connector or unrelated examples. Readiness checks require message sending; an explicitly requested business permission is checked when that operation fails and is repaired through supplementary authorization. Opening permissions in the application console does not itself grant those scopes to a saved user token.

The automation editor offers separate Feishu, DingTalk and WeChat delivery switches in a dropdown beside the access control, all off by default. Authorization reuses connector panels without losing the draft. The Host sends the final answer or failure/waiting status independently of model tools; run records retain delivery status and allow delivery-only retry. Feishu sends as the bot to its authenticated owner, DingTalk sends as the signed-in user to their own account, and WeChat uses the latest bound-owner inbound conversation. WeChat requires an initial inbound message; expired reply contexts fail delivery. Files are listed by desktop path; attachments are not uploaded. Legacy connector tool selections do not enable delivery.

Users can browse connector categories and inspect demonstration dialogs. The DingTalk card connects personal DingTalk Workspace CLI (`dws`) auth and installs the `dws-cli` skill under `$DSH_HOME/skills`. The WeChat Assistant card binds personal WeChat through Tencent iLink QR (in-app modal) and runs an inbound chat bridge so phone messages drive desktop Sessions with replies returned to WeChat; WeChat shows 「对方正在输入…」 while the desktop task runs. System Settings controls the page entry for Internet and intranet deployments; the default enables Internet and hides intranet.

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

Feishu uses the official `lark-cli` pinned to 1.0.98. The build exports its embedded official `lark-*` Skill Markdown and references beside the executable. A successful user authorization probe installs those skills under `$DSH_HOME/skills`, with desktop instructions routing commands through `feishu_cli`. Existing unrelated skills with conflicting names stop installation. Unbinding removes only connector-owned skill directories. Ordinary chat and automation read `lark-shared` and the relevant business skill before operating; application configuration and login remain on the connector page.

Feishu bidirectional tasks use the bot identity of the same self-built app to subscribe to `im.message.receive_v1` over a long connection. The Host verifies each event against the authorized user, accepts only that user's one-to-one text messages, reuses or creates a desktop Session, and replies through the bot. The app must enable the bot, event subscription, and bot message receive/send permissions; stopping or unbinding closes the channel and never forwards arbitrary group or other-user messages.

Connection checks user-message permission and starts the bidirectional channel automatically. Recommended login is followed by a targeted message-send grant when needed. Ready state requires the channel to be ready; the sheet offers Try and Unbind, with supplementary authorization or reconnect only when required. Unbind stops the channel.

The CLI emits `authorization_complete` after saving a user identity even when some requested permissions are missing, then exits 3. The connector decodes stdout/stderr separately, verifies the identity and reports missing scopes instead of a generic process failure. The pinned CLI deliberately excludes `im:message.send_as_user` from `--recommend`; the connection flow checks and requests message-send authorization before completing. Business missing-scope results stop further calls and enable supplementary authorization for the validated scopes. The connector verifies those scopes with `auth check` before clearing them. Application creation and user consent have separate QR-stage guidance; progress and credentials remain Host-owned.

The Feishu detail sheet uses the existing connector brand row, primary connection action and four example cards. The authorization QR is visible only while authorization is running. Connected users can try an example or unbind; first-time application setup remains a secondary entry below the connect button.

Connect probes CLI configuration before user login. A `not_configured` response starts the official application setup flow; successful setup continues to user authorization. Existing configurations go directly to user login. Verification URLs retain their original encoding. Failed processes expose validated error categories and subtypes rather than raw authorization output.

DingTalk on the connectors page means personal DWS authorization plus the `dws-cli` skill for desktop agent use (calendar, AI tables, docs, mail, todos, and related products). After the skill is copied, the Host inserts a personal-DM section: a request to message a person uses `dws chat +dm` on the saved login, and does not start another `dws auth login` or `send-by-bot` unless the user asks for a robot or supplies a webhook token. A robot notice is sent straight into the group with `dws chat +messages-send --as bot` after `dws chat +bot-find`, without adding the robot as a member. When `+bot-find` returns none, that send stops because `dws` cannot create a robot. The product ships `dingtalk-workspace-cli` (`dws`) and stages `app/assets/dws-cli` in the desktop runtime. **连接** starts `dws auth login` (browser OAuth / QR, typically returning to `127.0.0.1`) outside the WebView request without inheritable output pipes. The Host installs the staged skill (or the copy from `@dingtalk-real-ai/dsh-dingtalk`) when a lock-free `dws auth status --readonly` reports a saved login or, authoritatively, after the login process exits and normal status confirms it; if auth already succeeded, it only writes the skill. **解绑** removes the local skill copy and returns before any CLI process; DingTalk logout continues in the background. A later **连接** also returns before DWS starts. A dropped localhost request stays on that connector card; the connector directory and the expert catalog retry the local service instead of remaining on the service-unavailable page. WeChat Assistant means iLink QR bind (`loginStart` / `loginPoll`) with credentials under `$DSH_HOME/wechat-assistant` and a Host `getupdates` bridge that prompts a desktop Session and `sendmessage`s the reply. **去试试** stages an example prompt in the main composer, selects that connector on the blue `conversation.composer.tools` chip next to `+`, and auto-prepares a Workspace Session on first send (no workspace picker required). DingTalk **解绑** clears CLI credentials and skill copies; WeChat **取消连接** clears iLink credentials and stops the bridge. The product keeps `@dingtalk-real-ai/dsh-dingtalk` only as the `dws-cli` asset source; it does not mount DingTalk Stream IM or collect robot Client ID / Secret. Other connector rows remain demonstrations.

Opening the page checks the configured platform through the deployment refresh RPC in either network mode. A failed request shows a disconnected-plug placeholder; a successful check displays the local demonstration directory. Reopening the page checks again. This checks platform reachability, not third-party connector health or authorization. Administrator entry visibility still applies.

Disable this plugin's row to remove its entry; do not disable another business plugin as a substitute. Shared authentication, renderer and sidebar services remain provider-owned.

In intranet mode, the connector entry requires a successful enabled direct-connectivity probe. Disabled detection, offline resources or a failed probe leave a grey, non-clickable entry with the network-unreachable tooltip. Relay connectivity does not count as direct Internet access. Administrator-hidden entries remain hidden; Internet mode retains its existing service checks.

-----

The bound Feishu session also forwards new desktop user text, assembled assistant text, clarification questions and clarification tool results to the original robot DM. Plugin context, reasoning and unrelated sessions are excluded. Remote input is not echoed, and message keys distinguish session events from the initial task reply. Binding survives restart; synchronization resumes with the channel and stops on unbind. Ordinary clarification forms accept Feishu option numbers, exact labels, comma-separated multi-selections and free text. Multi-question forms collect answers in order. Desktop and Feishu compete for the same request; the first complete answer dismisses the other form. Attachments, permission approvals and plan-review confirmations still require desktop handling.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client owns its connector list, selection and dialogs. DingTalk detail uses Host RPC `/wanwei-dingtalk`; WeChat Assistant uses `/wanwei-wechat` (`status`, `loginStart`, `loginPoll`, `disconnect`). Secrets stay inside each CLI or iLink credential store; the Client only receives non-secret status and QR image data URLs. Status probes are cached briefly on Host and the Client paints from the last known status so「已连接」/「去试试」appear immediately on reopen.

The [Client entry](src/client/index.ts) supplies the UI. The [Host entry](src/index.ts) registers the connector RPC channels and the `dingtalk_dws` tool, which runs product-bundled `dws` in the Host process so desktop chat sees the same DingTalk login as the connector card. Session `pwsh`/`bash` cannot read `~/.dws` under the file sandbox.

After DingTalk connect, desktop sessions discover `dws-cli` through skill-filesystem. After WeChat Assistant connect, inbound WeChat text creates ordinary desktop Sessions through `sessionController`, so model/token use follows those Sessions.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Product composition](../../bundle/wanwei-desktop/README.md) — profile ownership.
- [Authentication and network policy](../oneapi-auth/README.md) — shared services.
- [Independent page decision](../../../.agents/notes/implemented/architecture/2026-10-10-independent-wanwei-pages.md) — lifecycle and dependency rationale.
- [Desktop DWS skills](../../../.agents/notes/implemented/feature/2026-10-16-wanwei-dingtalk-desktop-dws-skills.md) — why personal DWS auth is the DingTalk connectors success path.
- [Remove WeCom connector](../../../.agents/notes/implemented/simplification/2026-10-23-remove-wanwei-wecom-connector.md) — why enterprise WeChat packaging was removed.
- [WeChat Assistant iLink channel](../../../.agents/notes/implemented/feature/2026-10-19-wanwei-wechat-assistant-ilink.md) — personal WeChat inbound remote channel.

-----

<a id="model-experience"></a>
## Model Experience

The Host registers `dingtalk_dws`. Refreshing the copied `dws-cli` skill tells the model to call that tool for every `dws` command, not `pwsh` or `bash`: message a person with `dws chat +dm` when `authenticated` is already true, and use a robot or webhook only when the user asks for one. A robot notice uses `+bot-find` and then `+messages-send --as bot` directly into the group. The user's send request is the confirmation, so the command includes `--yes` without a second login or a second prompt. The CLI cannot create a robot.

#### KV Cache effect

`dingtalk_dws` is a standing Host tool. The personal-DM and execution sections load when the session reads the `dws-cli` skill.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The directory contains Feishu, DingTalk and WeChat Assistant. Feishu exports agent-readable Markdown only; upstream machine assets and scripts are not bundled. Real-account Feishu authorization and business execution still require integration validation.
- DingTalk ships its CLI inside the desktop `prepare:runtime` closure (WorkBuddy-style); PATH / `npm -g` is only a fallback.
- WeChat Assistant v1 handles direct text (and voice transcript) only; media and group chats are deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
