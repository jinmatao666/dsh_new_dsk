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

安装包 / `prepare:runtime` 构建必须包含当前平台的 `@wecom/cli-*` optional 包，以及落到 `app/assets/wecom-skills` 的随包技能（构建时下载技能包需要网络）。打包后的 Host 在已设置 `DSH_NODE_BINARY` 时不会在连接时再从 GitHub 下载，避免内网出现裸的 `Failed to fetch`。若授权已成功但技能尚未写入，「连接」会只安装技能、不再打开扫码页。在扫码授权成功且技能写入 `$DSH_HOME/skills` 之前，依赖企业微信 API 的桌面提示无法经这些技能执行。

「去试试」会写入示例提示，并在常驻的 `conversation.composer.tools` 芯片上选中企业微信（紧挨 `+`），行为与钉钉芯片一致。

个人微信入站聊天是另一张连接器卡片；见[微信助理 iLink 通道](2026-10-19-wanwei-wechat-assistant-ilink.zh.md)。
