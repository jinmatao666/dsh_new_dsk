# Agent Note: 万维微信助理是入站 iLink 远程通道

Status: implemented

[English](2026-10-19-wanwei-wechat-assistant-ilink.md) | 中文

## Problem

WorkBuddy 的**微信助理**让用户在连接器里扫码一次，即可在微信聊天窗口指挥桌面 Agent，并把结果回传到聊天。万维已把钉钉做成**桌面技能 CLI**（浏览器扫码 → `$DSH_HOME` 下技能；企业微信 CLI 随包随后已删除）。该模式无法表达个人微信入站：没有官方 “wechat-cli 技能包”，且「已连接」必须表示存活的 iLink 机器人会话，而不是 skill-filesystem 是否存在。

## Decision

新增连接器目录实卡**微信助理**（`wechat-channel`），其成功态为 **腾讯 iLink 扫码绑定 + `$DSH_HOME/wechat-assistant` 凭据 + Host 长轮询桥接**。

Host RPC `/wanwei-wechat` 提供 `status` / `loginStart` / `loginPoll` / `disconnect`。**连接**打开**应用内**二维码弹窗（PNG data URL），轮询至 `confirmed`，然后启动 `getupdates` → 桌面 `sessionController.prompt` → `sendmessage`。桌面任务执行期间，桥接通过 `getconfig`（`typing_ticket`，在桥接生命周期内按用户缓存，发送被拒时清除）和每 5 秒一次的 `sendtyping` 状态 `1` 在微信显示「对方正在输入…」，任务结束后在后台发送状态 `2` 取消；回复从不等待输入状态请求，输入状态发送失败会记日志并停止保活。**取消连接**清除凭据并停止桥接。密钥不进入 Client。

这有意不同于[桌面 DWS 技能](2026-10-16-wanwei-dingtalk-desktop-dws-skills.zh.md)：该路径在技能诉求下否决把 Stream/webhook 当作「已连接」；微信助理的产品诉求*就是*远程通道。企业微信 CLI 随包随后已删除，见[移除万维企业微信连接器](../simplification/2026-10-23-remove-wanwei-wecom-connector.zh.md)。

## Alternatives considered

**复用企业微信卡片 / wecom-cli：** 否决——企业微信 CLI 技能会是桌面对话里的出站 API 工具，不是个人微信入站聊天。

**把 `@tencent-weixin/openclaw-weixin` 当作 OpenClaw 插件随包：** 否决——万维不是 OpenClaw Gateway 宿主；Harness 已拥有 Session/Agent 生命周期。改为在 `wanwei-connectors` 内复用公开 iLink 协议（`ilink_appid: bot`、扫码 + getupdates + sendmessage）。

**只做连接 UX、不做消息桥：** 否决，因产品要求 WorkBuddy 第 5 步交互；没有 `getupdates` 的凭据会使「已连接」失去意义。

## Consequences

`wanwei-connectors` Host 注入 `sessionController` / `sessions` / `agents` / `workspaceRegistry` / `permissionPresets`，以便入站微信文本驱动 `$DSH_HOME/wechat-workspace` 下**有且仅有一个**普通桌面 Session（可用 `DSH_WECHAT_WORKSPACE` 覆盖）。Session id 跨消息复用（`desktop-session.json` + 工作区 `sessionIds`）；工作区与 Session 标题固定为 **微信助理**。Host 在桥接启动时创建该 Session；`ensureSession` / status 的 `sessionId` 对外暴露。同一产品 home 上并发的 `ensureWeChatDesktopSession` 共用一个 in-flight Promise，避免桥接启动与 Client「去试试」各建一个 Session（[去试试与入站对齐](../bug-fix/2026-10-23-wechat-go-try-inbound-same-session.zh.md)）。Client 在扫码绑定成功与 **去试试** 时打开该会话（先刷新 Session 列表，未知 id 再刷一次再选中），打开失败时保留当前选中而不 `clear`，并在入站任务使 Session 进入 running 时重新聚焦——不要求选择工作空间。安装包需要对 `ilinkai.weixin.qq.com`（及绑定后的账号 `baseurl`）出站 HTTPS。v1 不含媒体消息与群聊（仅文本与语音转写）。配对码（`need_verifycode`）在二维码弹窗中收集。二维码弹窗打开期间 Client 也会探测 `status()`，以便 Host 已落盘凭据时即使 `loginPoll` 一元 RPC 未返回 `confirmed` 也能关闭弹窗（[扫码弹窗恢复](../bug-fix/2026-10-20-wechat-qr-modal-closes-on-host-auth.zh.md)）。
