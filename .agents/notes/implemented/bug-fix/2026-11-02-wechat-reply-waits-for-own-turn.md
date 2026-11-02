# Agent Note: WeChat Assistant replies when its own turn ends

Status: implemented

English | [中文](2026-11-02-wechat-reply-waits-for-own-turn.zh.md)

## Problem

After a phone message, the desktop transcript of the 微信助理 Session showed the finished answer, but the phone sometimes received it much later. The bridge sent the reply only after `agent.whenIdle()`, which resolves at whole-agent quiescence: a queued desktop follow-up, a background wake-up, or an idle maintenance task kept the phone waiting after its own answer was already visible. The reply also raced the typing cancel and any in-flight keepalive, unlike the iLink reference client (`@tencent-weixin/openclaw-weixin`), which sends the reply first and cancels typing afterwards. `sendmessage` responses with `ret != 0` were treated as success and a failed send was never retried, so a rejected reply was silently lost.

## Decision

- `runDesktopTask` observes `session/event` for the user message whose `source.rpcId` is the prompt's `requestId`, and settles on the next `turn/end`; the reply is the last non-empty assistant text inside that turn. `whenIdle()` only detects a prompt cancelled out of the inbox before any turn claimed it, which replies `任务未执行：消息在开始前已被取消`.
- `sendTextReply` treats `ret != 0` as failure and makes up to `REPLY_SEND_ATTEMPTS` (3) attempts 500 ms apart, reusing one `client_id`.
- Typing requests for a bridge run one at a time on a shared queue. A keepalive tick is skipped while the previous typing request is still queued, a queued typing request is dropped once its message stops, and the cancel status is enqueued when the task ends but sent only after the reply settles. The reply never waits on typing.

## Alternatives considered

**Keep `whenIdle()` and add a timeout:** rejected — a timeout either cuts off a long task or still delays the reply behind unrelated work; the consumed turn is the exact completion point.

**Fold the reply into `foldConsumedWork`:** rejected — that fold accounts an owned log suffix after cancellation and needs a settled log; the bridge needs a live completion signal for one prompt.

**Retry with a fresh `client_id`:** rejected — reusing the id lets iLink treat a retry of an accepted send as the same message.

## Consequences

Host tests cover a reply sent while `whenIdle()` never settles, a prompt dropped before its turn, the reply-then-cancel order across two messages, a transient `sendmessage` failure retried with the same `client_id`, and a persistent `ret != 0` reported after three attempts. The phone-side latency itself was not reproduced on a device in this change; packaged builds need this Host change before retesting. Product rules remain in [WeChat Assistant iLink channel](../feature/2026-10-19-wanwei-wechat-assistant-ilink.md).
