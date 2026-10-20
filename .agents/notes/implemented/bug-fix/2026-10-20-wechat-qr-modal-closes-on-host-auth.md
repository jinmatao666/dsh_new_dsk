# Agent Note: WeChat QR modal closes when Host auth lands

Status: implemented

English | [中文](2026-10-20-wechat-qr-modal-closes-on-host-auth.zh.md)

## Problem

Packaged desktop install tests showed that after WeChat scan-and-authorize, the in-app QR sheet stayed open and never showed「微信助理已连接」.「去试试」/「取消连接」appeared only later (often after the user sent a phone message and reopened the connectors UI). Host had already persisted iLink credentials and started `getupdates`, so the remote channel worked while the Client still waited on a hung or lost `loginPoll` unary RPC.

## Decision

Keep QR bind on `/wanwei-wechat` `loginStart` / `loginPoll`, and make completion observable without relying on a single long-lived poll response:

- Cap each Host `get_qrcode_status` long-poll at 20s so unary RPC stays under common idle limits; the Client already loops.
- While the QR sheet is open, probe `status()` every 1.5s; if `authed`, close the sheet and toast「微信助理已连接」even when `loginPoll` never returns `confirmed`.
- If `loginPoll` errors, times out, or reports no active session, adopt Host `status()` when credentials already exist.
- When iLink returns `confirmed` without `bot_token` / `ilink_bot_id`, re-poll the same QR up to three times before failing.
- Send stored `bot_token` values in `local_token_list` on QR create/refresh so `binded_redirect` can succeed.

## Alternatives considered

**Move the entire wait loop onto the Host behind one multi-minute RPC:** rejected — desktop unary RPC and reverse proxies are a poor fit for multi-minute holds; short polls plus a status probe recover the lost-response case without a new channel.

**Only shorten the long-poll:** rejected — it reduces hang risk but does not close the sheet when credentials already landed on a prior poll the Client never observed.

## Consequences

`WeChatPanel` settles connect success through either `loginPoll` `confirmed` or a successful `status()` probe, with a one-shot guard against double toasts. Host `pollWeChatLogin` returns `confirmed` when the session key is gone but credentials are already on disk. Package tests cover credential recovery, confirmed-without-token re-poll, and Client QR close from `status()` while `loginPoll` hangs. Related product decision: [WeChat Assistant iLink channel](../feature/2026-10-19-wanwei-wechat-assistant-ilink.md).
