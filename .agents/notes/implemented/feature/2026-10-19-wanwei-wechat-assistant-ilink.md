# Agent Note: Wanwei WeChat Assistant is an inbound iLink remote channel

Status: implemented

English | [中文](2026-10-19-wanwei-wechat-assistant-ilink.zh.md)

## Problem

WorkBuddy’s **微信助理** lets users scan once in the connectors UI, then command the desktop agent from the WeChat chat window with results returned in-chat. Wanwei already shipped DingTalk/WeCom as **desktop skill CLIs** (browser QR → skills under `$DSH_HOME`). That pattern cannot express inbound personal WeChat: there is no official “wechat-cli skill pack,” and “已连接” must mean a live iLink bot session, not skill-filesystem presence.

## Decision

Add a live connectors catalog row **微信助理** (`wechat-channel`) whose success state is **Tencent iLink QR bind + stored bot credentials under `$DSH_HOME/wechat-assistant` + a Host long-poll bridge**.

Host RPC `/wanwei-wechat` exposes `status` / `loginStart` / `loginPoll` / `disconnect`. **连接** opens an **in-app** QR modal (PNG data URL), polls until `confirmed`, then starts `getupdates` → desktop `sessionController.prompt` → `sendmessage`. **取消连接** clears credentials and stops the bridge. Secrets never reach the Client.

This is intentionally different from [Desktop WeCom CLI skills](2026-10-19-wanwei-wecom-desktop-cli-skills.md) and [Desktop DWS skills](2026-10-16-wanwei-dingtalk-desktop-dws-skills.md): those reject Stream/webhook as “已连接” for a skill ask; WeChat Assistant’s product ask *is* the remote channel.

## Alternatives considered

**Reuse WeCom card / wecom-cli:** rejected — enterprise WeChat CLI skills are outbound API tools in desktop chat, not personal WeChat inbound chat.

**Bundle `@tencent-weixin/openclaw-weixin` as an OpenClaw plugin:** rejected — Wanwei is not an OpenClaw Gateway host; the harness already owns Session/Agent lifecycle. Reuse the public iLink protocol (`ilink_appid: bot`, QR + getupdates + sendmessage) inside `wanwei-connectors` instead.

**Connect UX only without the message bridge:** rejected for the WorkBuddy step-5 interaction the product requires; credentials without `getupdates` would leave “已连接” meaningless.

## Consequences

`wanwei-connectors` Host injects `sessionController` / `sessions` / `agents` / `workspaceRegistry` / `permissionPresets` so inbound WeChat text can create ordinary desktop Sessions (workspace under `$DSH_HOME/wechat-workspace`, overridable via `DSH_WECHAT_WORKSPACE`). Client **去试试** stages an example prompt and auto-prepares a Workspace Session on first send via `create_automatic_workspace` (same path as skill-marketplace), so no workspace picker is required. Installers need outbound HTTPS to `ilinkai.weixin.qq.com` (and the account `baseurl` after bind). Media messages and group chats are out of scope for v1 (text + voice transcript only). Pairing digits (`need_verifycode`) are collected in the QR modal.
