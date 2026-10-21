# Agent Note: 万维企业微信连接器以桌面 wecom-cli 技能为准

Status: implemented

[English](2026-10-19-wanwei-wecom-desktop-cli-skills.md) | 中文

## 问题

连接器目录把企业微信列为演示卡片。产品期望的是 WorkBuddy 闭环：点「连接」、扫码一次，即可在桌面对话使用企业微信技能——不要求用户另行执行 `npm install -g @wecom/cli`。

## 决策

连接器企业微信卡片的主「已连接」状态是 **wecom-cli 授权 + 安装到 `$DSH_HOME/skills` 的官方 `wecomcli-*` 技能**，由 skill-filesystem 供桌面会话发现。Host RPC `/wanwei-wecom` 提供 `status` / `login`（`wecom-cli auth init --noninteractive`）/ `installSkill` / `disconnect`。

桌面产品在 **`prepare:runtime` 中随包 `@wecom/cli`（平台 optional 二进制）**，并把 Agent Skills 放到 `runtime/app/assets/wecom-skills`。Host 解析优先使用随包二进制（`DSH_WECOM_CLI` / `DSH_NODE_BINARY` 旁 / 产品 `node_modules`），PATH 仅作回退。技能安装优先用随包资源，仅在开发回退时从 GitHub 下载。Bot ID / Secret 从不出现在连接器 UI。

这复用官方 CLI 扫码流（`source=wecom_cli_external`），并对齐 WorkBuddy「打开应用即可连接」的体验。

## 考虑过的替代方案

**要求运维 `npm install -g @wecom/cli`：** 否决，因不符合产品 UX；WorkBuddy 不要求终端用户单独安装 CLI。

**在 wanwei/connectors 手搓企业微信 OpenAPI：** 否决，因为官方 CLI 已拥有扫码绑定、加密凭据与面向 Agent 的产品技能。

**把 Stream/Webhook 机器人接线当作「已连接」：** 否决，因不符合桌面技能诉求。

## 后果

安装包 / `prepare:runtime` 构建必须包含当前平台的 `@wecom/cli-*` optional 包，以及落到 `app/assets/wecom-skills` 的随包技能（构建时下载技能包需要网络）。`tauri dev` 通过 `ensure:wecom-skills` 写入 `products/wanwei-desktop/assets/wecom-skills`，存在时设置 `DSH_WECOM_SKILLS_DIR`；`DSH_DESKTOP_DEVELOPMENT=1` 仍允许连接时从 GitHub 回退下载技能。打包后的 Host 经 `DSH_WECOM_SKILLS_DIR` / `DSH_APP_ROOT` / `DSH_NODE_BINARY` → `app/assets/wecom-skills` 解析技能，并拒绝连接时再从 GitHub 下载，避免内网出现裸的 `Failed to fetch`。「连接」直接启动 `wecom-cli auth init --noninteractive`（浏览器扫码），不先执行 `auth show`，因为该探测会挂起且浏览器不会打开。调用在进程启动前返回 `authorizing: true`；二维码授权后，Host 观察稳定写入的 `<config_dir>/credentials.enc`，安装技能、停止 init 进程并发布已连接状态，不再等待该进程自行退出。所有受支持平台的默认配置目录都是 `~/.config/wecom`，`WECOM_CLI_CONFIG_DIR` 可覆盖该目录。若把整段扫码挂在同一次登录 RPC 上，桌面 WebView 在从系统浏览器回来后会报 `Failed to fetch`。**解绑**只清凭据和技能副本，不再启动 `wecom-cli`，因此这次请求不会停在 `auth show` 上。随后的**连接**会在 `auth init` 启动前返回 `authorizing: true`。连接器目录和专家库会重试被丢掉的本机检查，不会停在整页的服务不可用提示上。「连接」始终启动这次扫码进程，包括此时仍有 `auth show` 在跑的情况。该探测不会打开浏览器，会先被停掉，以免占住 CLI。Client 不在连接器目录和输入框连接器选择器里展示企业微信，也不探测其状态；产品 UI 停用二维码完成路径期间，Host RPC 和随包资源仍保留。桌面壳在 sidecar 启动前也会把 `app/assets/dws-cli` 与 `app/assets/wecom-skills` 复制到 `$DSH_HOME/skills`。在扫码授权成功且技能写入之前，依赖企业微信 API 的桌面提示无法经这些技能执行。

「去试试」会写入示例提示，并在常驻的 `conversation.composer.tools` 芯片上选中企业微信（紧挨 `+`），行为与钉钉芯片一致。

个人微信入站聊天是另一张连接器卡片；见[微信助理 iLink 通道](2026-10-19-wanwei-wechat-assistant-ilink.zh.md)。
