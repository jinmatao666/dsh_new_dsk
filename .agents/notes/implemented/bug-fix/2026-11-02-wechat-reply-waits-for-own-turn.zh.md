# Agent Note: 微信助理在自身轮次结束时回复

Status: implemented

[English](2026-11-02-wechat-reply-waits-for-own-turn.md) | 中文

## Problem

手机发送消息后，桌面端微信助理会话已显示完整回答，但手机有时很久才收到。桥接在 `agent.whenIdle()` 之后才发送回复，而它要等整个 agent 完全停稳：排队的桌面追问、后台唤醒或空闲维护任务都会让手机在自己的回答早已可见后继续等待。回复还与取消输入状态及进行中的保活请求竞争，与 iLink 参考客户端（`@tencent-weixin/openclaw-weixin`）先发回复、后取消输入状态的顺序不同。`sendmessage` 返回 `ret != 0` 被当作成功，发送失败也从不重试，被拒的回复会静默丢失。

## Decision

- `runDesktopTask` 观察 `session/event`，找到 `source.rpcId` 等于本次 prompt `requestId` 的用户消息，并在其后的第一个 `turn/end` 结束等待；回复取该轮次内最后一段非空助手文本。`whenIdle()` 只用于识别在任何轮次认领前就被移出收件箱的 prompt，此时回复 `任务未执行：消息在开始前已被取消`。
- `sendTextReply` 把 `ret != 0` 视为失败，最多尝试 `REPLY_SEND_ATTEMPTS`（3）次，间隔 500 ms，并复用同一个 `client_id`。
- 同一桥接的输入状态请求在共享队列上逐个发送。上一条输入状态请求仍在排队时跳过保活，消息停止后丢弃仍在排队的输入状态请求；任务结束时把取消状态加入队列，但要等回复完成后才发送。回复从不等待输入状态。

## Alternatives considered

**保留 `whenIdle()` 并加超时：** 否决——超时要么截断长任务，要么仍让回复排在无关工作之后；被消费的轮次才是准确的完成点。

**把回复并入 `foldConsumedWork`：** 否决——它在取消后统计自有日志后缀，需要已定型的日志；桥接需要单个 prompt 的实时完成信号。

**用新的 `client_id` 重试：** 否决——复用 id 能让 iLink 把已接受发送的重试视为同一条消息。

## Consequences

Host 测试覆盖 `whenIdle()` 永不完成时仍发送回复、prompt 在轮次前被丢弃、两条消息下先回复后取消的顺序、`sendmessage` 瞬时失败以同一 `client_id` 重试，以及持续 `ret != 0` 在三次尝试后报告。本次未在真机上复现手机端延迟；打包桌面需带上本次 Host 改动后再复测。产品规则仍见[微信助理 iLink 通道](../feature/2026-10-19-wanwei-wechat-assistant-ilink.zh.md)。
