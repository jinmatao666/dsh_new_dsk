# Agent Note: WeChat「去试试」and inbound share one Session view

Status: implemented

English | [中文](2026-10-23-wechat-go-try-inbound-same-session.zh.md)

## Problem

On packaged desktop, after「去试试」opened the WeChat Assistant Session, a phone message such as「打开百度地图」did not appear in that chat. Host still ran the inbound bridge and could reply on WeChat, so the defect was Client/Host Session identity and selection, not iLink delivery.

## Decision

Keep one durable Session under `wechat-workspace`, and make「去试试」and inbound prompt the same id in the same Client view:

- Coalesce concurrent `ensureWeChatDesktopSession` calls per product home onto one in-flight promise so bridge start and Client `ensureSession` cannot each create a Session and overwrite `desktop-session.json`.
- On「去试试」/ bind success: `ensureSession` → refresh list → `sessions.open` (retry refresh+open once); on failure stage the example draft but do **not** `sessions.clear()` (clear hid Host-side turns).
- When the fixed Session’s list row is `running`, open it if it is not already current; when status reports `authed` without a `sessionId`, the composer chip calls `ensureSession` so the focus rule has an id.
- `ensureWeChatDesktopSession` replaces a candidate only on `session-not-found`; any other resume failure throws instead of creating a second Session. The title is set once at creation, so inbound messages do not append a `session/title` event each time.
- `startWeChatBridge` is a no-op while a bridge polls with the same bot token, so repeated `loginPoll` / `status` calls cannot abort an in-flight phone task. A replaced bridge loop does not send `notifystop`; only a real stop announces offline, using the loop's own credentials. A failed empty-text reply no longer kills the loop, and `status` revives a loop that exited.

## Alternatives considered

**Let Client create the Session and pass the id to the bridge:** rejected — inbound must work with no Client open; Host remains the Session authority.

**Clear selection and rely on staged draft after open failure:** rejected — that path produced the empty「去试试」view while Host wrote another Session.

## Consequences

Host tests cover concurrent ensure coalescing to one `create`, reuse without rename, no create on a transient resume failure, and one `notifystart` / no replaced-loop `notifystop` across repeated bridge starts. Client open failure no longer clears selection. Product rule remains [WeChat Assistant iLink channel](../feature/2026-10-19-wanwei-wechat-assistant-ilink.md). Packaged builds need this Host+Client change before retest.
