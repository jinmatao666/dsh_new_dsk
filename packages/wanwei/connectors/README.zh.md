---
description: "展示独立的万维连接器页面，入口显示由后台控制。"
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-connectors

[English](README.md) | 中文

## 概述

用户可以浏览连接器分类并查看演示弹窗。钉钉卡片连接本机钉钉 Workspace CLI（`dws`）个人授权，并把 `dws-cli` 技能安装到 `$DSH_HOME/skills`。企业微信卡片连接官方 `@wecom/cli` 授权，并把 `wecomcli-*` 技能安装到同一 home。微信助理卡片通过腾讯 iLink 扫码（应用内二维码）绑定个人微信，并运行入站聊天桥接，使手机消息驱动桌面 Session、结果回传到微信。系统设置分别控制互联网和纯内网部署的入口；默认互联网开启、纯内网隐藏。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

万维桌面产品通过[组合补丁](../../bundle/wanwei-desktop/cordis.patch.yml)挂载本插件。它没有单独的插件配置字段。

连接器页的钉钉表示个人 DWS 授权加上供桌面 Agent 使用的 `dws-cli` 技能（日历、AI 表格、文档、邮箱、待办等相关产品）。产品在桌面 runtime 随包 `dingtalk-workspace-cli`（`dws`）并落盘 `app/assets/dws-cli`。**连接**在 WebView 请求外启动 `dws auth login`（浏览器 OAuth / 扫码，通常回调本机 `127.0.0.1`），再轮询 Host 状态，直到无锁的 `dws auth status --readonly` 报告登录已保存（即使 `dws auth login` 仍在运行），然后从随包资源（或 `@dingtalk-real-ai/dsh-dingtalk`）安装技能；若授权已成功则只写技能、不再打开浏览器。**解绑**先删掉本机技能副本并立刻返回；钉钉的退出登录在后台继续，企业微信解绑不会再启动 `wecom-cli`。之后的**连接**也会在 `wecom-cli` 启动前返回。单次本机请求被丢掉时只留在该连接器卡片上；连接器目录和专家库会重试本机服务，不会停在整页的服务不可用提示上。企业微信表示产品随包的 `wecom-cli` 扫码授权（直接 `auth init --noninteractive`，不先执行 `auth show`）；Host 观察稳定写入的 `~/.config/wecom/credentials.enc`，把 `app/assets/wecom-skills` 中的官方 `wecomcli-*` 技能复制到 `$DSH_HOME/skills`，并在 init 自行退出前报告已连接（打包后的 Host 连接时不会再从 GitHub 下载技能）。微信助理表示 iLink 扫码绑定（`loginStart` / `loginPoll`），凭据落在 `$DSH_HOME/wechat-assistant`，并由 Host `getupdates` 桥接：创建桌面 Session 执行后经 `sendmessage` 回传到微信。**去试试**会把示例提示写入主输入框，并在 `+` 旁蓝色的 `conversation.composer.tools` 芯片上选中对应连接器（点击可切换连接器或重新打开本页）；首次发送时自动准备工作区 Session，无需先手动选择工作空间。钉钉/企业微信**解绑**清除 CLI 凭据与技能副本；微信**取消连接**清除 iLink 凭据并停止桥接。产品仅把 `@dingtalk-real-ai/dsh-dingtalk` 当作 `dws-cli` 资源来源；不挂载钉钉 Stream IM，也不收集机器人 Client ID / Secret。其余连接器条目仍为演示。

Client 当前不在连接器目录和输入框连接器选择器里展示企业微信，也不探测其状态；Host RPC 和随包 CLI/技能资源仍保持挂载。

两种网络模式下打开页面都会通过部署配置刷新 RPC 检查配置的平台。请求失败显示断开插头占位；成功后显示本地演示目录。重新打开页面会再次检查。此检查只验证平台可达性，不代表第三方连接器健康或已授权。管理员入口显示开关仍有效。

停用本插件的配置项会移除其入口；不需要停用其他业务插件。共用鉴权、渲染和侧边栏服务仍由各提供方负责。

内网模式下，连接器入口要求启用直连检测且检测成功。关闭检测、使用离线资源或检测失败时，入口置灰且不可点击，悬停显示网络不可达提示。中转可用不算直连互联网。管理员隐藏的入口仍然隐藏；外网模式保留既有服务检查。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Client 拥有连接器列表、选择状态和弹窗。钉钉详情走 Host RPC `/wanwei-dingtalk`；企业微信走 `/wanwei-wecom`（`status`、`login`、`installSkill`、`disconnect`）；微信助理走 `/wanwei-wechat`（`status`、`loginStart`、`loginPoll`、`disconnect`）。密钥留在各自 CLI 或 iLink 凭据库；Client 只收到非机密状态与二维码图片 data URL。状态探测在 Host 短缓存，Client 用最近一次状态立刻画出「已连接」/「去试试」，再后台刷新。

[Client 入口](src/client/index.ts)提供界面。[Host 入口](src/index.ts)注册连接器 RPC。

钉钉/企业微信连接后，桌面会话通过 skill-filesystem 发现 `dws-cli` 和/或 `wecomcli-*`。微信助理连接后，入站微信文本经 `sessionController` 创建普通桌面 Session，模型与 token 消耗跟随这些 Session。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [产品组合](../../bundle/wanwei-desktop/README.zh.md) — profile 归属。
- [鉴权与网络策略](../oneapi-auth/README.zh.md) — 共用服务。
- [独立页面决策](../../../.agents/notes/implemented/architecture/2026-10-10-independent-wanwei-pages.zh.md) — 生命周期和依赖依据。
- [桌面 DWS 技能](../../../.agents/notes/implemented/feature/2026-10-16-wanwei-dingtalk-desktop-dws-skills.zh.md) — 为何以个人 DWS 授权为钉钉连接器成功路径。
- [桌面企业微信 CLI 技能](../../../.agents/notes/implemented/feature/2026-10-19-wanwei-wecom-desktop-cli-skills.zh.md) — 企业微信 wecom-cli 授权与技能路径。
- [微信助理 iLink 通道](../../../.agents/notes/implemented/feature/2026-10-19-wanwei-wechat-assistant-ilink.zh.md) — 个人微信入站远程通道。

-----

<a id="model-experience"></a>
## Model Experience

无，因为 Client 展示本身不注册提示词或工具。

#### KV Cache effect

不直接修改模型上下文或缓存复用。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 除钉钉 DWS、企业微信 wecom-cli 与微信助理 iLink 路径外，本页其余条目仍为演示，未实现真实授权与服务执行。
- 钉钉与企业微信均在桌面 `prepare:runtime` 闭包中随包 CLI（WorkBuddy 体验）；PATH / `npm -g` 仅作回退。
- 微信助理 v1 仅处理私聊文本（及语音转写）；媒体与群聊延后。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
