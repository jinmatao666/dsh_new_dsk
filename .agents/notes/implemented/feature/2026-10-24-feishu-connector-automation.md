# Agent Note: 飞书连接器与自动化连接器选择

Status: implemented

English | [中文](2026-10-24-feishu-connector-automation.zh.md)

## Problem

连接器目录需要只展示飞书、钉钉和微信，自动化需要在任务执行时使用明确选择的连接器。

## Decision

桌面 runtime 随包固定版本的官方 `lark-cli`，构建时校验 SHA-256，运行时通过原生 argv 调用，不把密钥交给子进程环境。飞书授权、配置和退出登录由连接器页面管理；业务命令由 `feishu_cli` 工具执行。

自动化采用[自动化结果推送](2026-10-29-automation-result-delivery.md)中的独立推送配置；连接器身份、业务技能和双向会话机制仍由本记录描述。

## Alternatives considered

**保留演示目录。** 这会让用户误以为未实现的卡片可以执行真实操作，因此目录只保留三条真实入口。

**在自动化中复用聊天框选择。** 定时任务没有稳定的聊天框状态，任务持久化自己的选择并在执行前重新校验。

**开放微信任意收件人发送。** 当前微信通道只保存绑定用户的最近回复上下文，开放任意收件人会扩大授权范围，因此暂不提供。

Feishu synchronization observes new events in the bound desktop session instead of only returning one final result for each inbound task. A persisted session/message binding scopes desktop followups, assistant messages and clarification exchanges to the original owner DM. Outgoing delivery uses a separate serialized queue so clarification questions can reach Feishu while the task waits for a desktop answer. Inbound request IDs suppress echoes; event sequence keys prevent duplicate replies. Unbinding aborts and awaits outgoing work. WeChat behavior is unchanged.

A prepended user-question answerer keeps the desktop form active while accepting owner-verified Feishu text outside the inbound task queue. Question answers therefore cannot deadlock behind the task waiting for them. One invocation-scoped cancellation controller ends the losing desktop form when Feishu finishes, while task cancellation or disconnect rejects both paths. Only ordinary clarifications are accepted; tagged plan review and permission approvals remain desktop-owned. Multi-question answers are collected in order, with exact option labels or numbers, multi-select validation and free text.

## Consequences

The pinned CLI can save an identity, emit an `authorization_complete` event with missing scopes, and exit 3. Authorization streams are decoded separately and identity/scopes are checked independently. Missing permission names are safe connector state; raw output and device codes remain private. The CLI intentionally excludes `im:message.send_as_user` from recommended batch grants, so the connector checks and requests the message-send grant within connection and offers supplementary grants after business failures. Missing-scope failures stop retries until `auth check` confirms the requested permissions. Creating an application and authorizing its user show separate QR-stage guidance.

Connect handles an unconfigured CLI as a setup prerequisite: application initialization runs before user authorization, while existing configurations skip initialization. A single background operation owns both stages and rejects duplicate starts. Complete verification URLs are preserved as opaque strings; failures expose validated categories and subtypes without forwarding raw authentication output.

The build exports official Skill Markdown and references embedded in the pinned CLI, retaining sibling links without a runtime download. Authorized status checks install those files in the product's own skills root and prepend desktop tool instructions after YAML frontmatter. Per-directory ownership markers prevent replacement or removal of unrelated skills. Business tools and automation direct the model to read the shared and relevant business skills; authentication stays on the connector page. Machine assets and scripts are outside the embedded export.

飞书在互联网环境中可通过官方 CLI 覆盖消息、文档、日历和待办等业务域；首次使用需要配置应用并完成用户授权。CLI 二进制和授权状态探测不依赖 WebView 内的 shell。

Feishu bidirectional tasks use the bot identity of the same self-built app to subscribe to `im.message.receive_v1` over a long connection. The Host verifies each event against the authorized user, accepts only that user's one-to-one text messages, reuses or creates a desktop Session, and replies through the bot. The app must enable the bot, event subscription, and bot message receive/send permissions; stopping or unbinding closes the channel and never forwards arbitrary group or other-user messages.

The channel starts automatically for an authorized identity without a saved preference. A saved disabled state remains authoritative across reauthorization and restart. The connector sheet separates personal authorization from bot-channel readiness: a compact status remains visible, while setup guidance appears only for channel errors.

自动化任务可能因连接器未授权、服务不可达或用户确认缺失而进入失败或等待状态。自动化的任务结束推送由[自动化结果推送](2026-10-29-automation-result-delivery.md)负责。

## Verification

连接器与自动化 Host/Client TypeScript 项目通过定向 `tsc -b`；连接器 UI、DingTalk、WeChat 和自动化测试覆盖既有路径，飞书状态解析有单元测试。官方 CLI 运行时输出 `not_configured`，证明未配置时不会误报已授权。
