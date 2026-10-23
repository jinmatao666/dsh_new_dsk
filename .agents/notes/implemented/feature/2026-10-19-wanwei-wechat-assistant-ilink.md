# Agent Note: Wanwei WeChat Assistant is an inbound iLink remote channel

Status: implemented

English | [中文](2026-10-19-wanwei-wechat-assistant-ilink.zh.md)

## Problem

WorkBuddy’s **微信助理** lets users scan once in the connectors UI, then command the desktop agent from the WeChat chat window with results returned in-chat. Wanwei already shipped DingTalk as a **desktop skill CLI** (browser QR → skills under `$DSH_HOME`; WeCom CLI packaging was later removed). That pattern cannot express inbound personal WeChat: there is no official “wechat-cli skill pack,” and “已连接” must mean a live iLink bot session, not skill-filesystem presence.

## Decision

Add a live connectors catalog row **微信助理** (`wechat-channel`) whose success state is **Tencent iLink QR bind + stored bot credentials under `$DSH_HOME/wechat-assistant` + a Host long-poll bridge**.

Host RPC `/wanwei-wechat` exposes `status` / `loginStart` / `loginPoll` / `disconnect`. **连接** opens an **in-app** QR modal (PNG data URL), polls until `confirmed`, then starts `getupdates` → desktop `sessionController.prompt` → `sendmessage`. **取消连接** clears credentials and stops the bridge. Secrets never reach the Client.

This is intentionally different from [Desktop DWS skills](2026-10-16-wanwei-dingtalk-desktop-dws-skills.md): that path rejects Stream/webhook as “已连接” for a skill ask; WeChat Assistant’s product ask *is* the remote channel. WeCom CLI packaging was later removed; see [Remove the Wanwei WeCom connector](../simplification/2026-10-23-remove-wanwei-wecom-connector.md).

## Alternatives considered

**Reuse a WeCom card / wecom-cli:** rejected — enterprise WeChat CLI skills would be outbound API tools in desktop chat, not personal WeChat inbound chat.

**Bundle `@tencent-weixin/openclaw-weixin` as an OpenClaw plugin:** rejected — Wanwei is not an OpenClaw Gateway host; the harness already owns Session/Agent lifecycle. Reuse the public iLink protocol (`ilink_appid: bot`, QR + getupdates + sendmessage) inside `wanwei-connectors` instead.

**Connect UX only without the message bridge:** rejected for the WorkBuddy step-5 interaction the product requires; credentials without `getupdates` would leave “已连接” meaningless.

## Consequences

`wanwei-connectors` Host injects `sessionController` / `sessions` / `agents` / `workspaceRegistry` / `permissionPresets` so inbound WeChat text drives **exactly one** ordinary desktop Session under `$DSH_HOME/wechat-workspace` (overridable via `DSH_WECHAT_WORKSPACE`). The Session id is reused across messages (`desktop-session.json` + workspace `sessionIds`); Workspace and Session titles stay **微信助理**. Host creates that Session when the bridge starts; `ensureSession` / status `sessionId` expose it. Concurrent `ensureWeChatDesktopSession` callers for the same product home share one in-flight promise so bridge start and Client「去试试」cannot each mint a Session ([go-try / inbound alignment](../bug-fix/2026-10-23-wechat-go-try-inbound-same-session.md)). Client opens it after QR bind and on **去试试**, refreshes the Session list (retry once on unknown id) so selection succeeds, keeps selection on open failure instead of clearing, and refocuses when inbound work marks the Session running — no Workspace picker. Installers need outbound HTTPS to `ilinkai.weixin.qq.com` (and the account `baseurl` after bind). Media messages and group chats are out of scope for v1 (text + voice transcript only). Pairing digits (`need_verifycode`) are collected in the QR modal. While the QR sheet is open, the Client also probes `status()` so a Host that already persisted credentials can close the sheet even if a `loginPoll` unary RPC never returns `confirmed` ([QR modal recovery](../bug-fix/2026-10-20-wechat-qr-modal-closes-on-host-auth.md)).
