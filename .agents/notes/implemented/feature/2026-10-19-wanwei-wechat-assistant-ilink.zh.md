# Agent Note: 万维微信助理是入站 iLink 远程通道

Status: implemented

[English](2026-10-19-wanwei-wechat-assistant-ilink.md) | 中文

## Problem

WorkBuddy 的**微信助理**让用户在连接器里扫码一次，即可在微信聊天窗口指挥桌面 Agent，并把结果回传到聊天。万维已把钉钉/企业微信做成**桌面技能 CLI**（浏览器扫码 → `$DSH_HOME` 下技能）。该模式无法表达个人微信入站：没有官方 “wechat-cli 技能包”，且「已连接」必须表示存活的 iLink 机器人会话，而不是 skill-filesystem 是否存在。

## Decision

新增连接器目录实卡**微信助理**（`wechat-channel`），其成功态为 **腾讯 iLink 扫码绑定 + `$DSH_HOME/wechat-assistant` 凭据 + Host 长轮询桥接**。

Host RPC `/wanwei-wechat` 提供 `status` / `loginStart` / `loginPoll` / `disconnect`。**连接**打开**应用内**二维码弹窗（PNG data URL），轮询至 `confirmed`，然后启动 `getupdates` → 桌面 `sessionController.prompt` → `sendmessage`。**取消连接**清除凭据并停止桥接。密钥不进入 Client。

这有意不同于[桌面企业微信 CLI 技能](2026-10-19-wanwei-wecom-desktop-cli-skills.zh.md)与[桌面 DWS 技能](2026-10-16-wanwei-dingtalk-desktop-dws-skills.zh.md)：后者在技能诉求下否决把 Stream/webhook 当作「已连接」；微信助理的产品诉求*就是*远程通道。

## Alternatives considered

**复用企业微信卡片 / wecom-cli：** 否决——企业微信 CLI 技能是桌面对话里的出站 API 工具，不是个人微信入站聊天。

**把 `@tencent-weixin/openclaw-weixin` 当作 OpenClaw 插件随包：** 否决——万维不是 OpenClaw Gateway 宿主；Harness 已拥有 Session/Agent 生命周期。改为在 `wanwei-connectors` 内复用公开 iLink 协议（`ilink_appid: bot`、扫码 + getupdates + sendmessage）。

**只做连接 UX、不做消息桥：** 否决，因产品要求 WorkBuddy 第 5 步交互；没有 `getupdates` 的凭据会使「已连接」失去意义。

## Consequences

`wanwei-connectors` Host 注入 `sessionController` / `sessions` / `agents` / `workspaceRegistry` / `permissionPresets`，以便入站微信文本创建普通桌面 Session（工作区在 `$DSH_HOME/wechat-workspace`，可用 `DSH_WECHAT_WORKSPACE` 覆盖）。Client **去试试** 会暂存示例提示，并在首次发送时经 `create_automatic_workspace` 自动准备工作区 Session（与技能市场同路径），无需先选择工作空间。安装包需要对 `ilinkai.weixin.qq.com`（及绑定后的账号 `baseurl`）出站 HTTPS。v1 不含媒体消息与群聊（仅文本与语音转写）。配对码（`need_verifycode`）在二维码弹窗中收集。
