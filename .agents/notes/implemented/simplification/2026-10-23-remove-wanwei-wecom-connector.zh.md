# Agent Note: 移除万维企业微信连接器

Status: implemented

[English](2026-10-23-remove-wanwei-wecom-connector.md) | 中文

## 问题

万维连接器包仍保留完整企业微信路径：Host `/wanwei-wecom` RPC、Client 面板与目录行（已隐藏）、桌面随包 `@wecom/cli`，以及 `wecomcli-*` 技能落盘。产品不再提供该连接器；继续保留只会让安装包下载、可选原生二进制和无人使用的 Host/Client 面继续膨胀。

## 决策

端到端删除企业微信连接器。移除 Host `wecom-cli` 辅助与 `/wanwei-wecom` 注册，Client 的企业微信面板 / API / 状态缓存 / 文案 key / 目录行，企业微信专用测试，`wecom.png`、`ensure:wecom-skills`、`prepare:runtime` 企业微信暂存、Tauri 技能拷贝与 `DSH_WECOM_SKILLS_DIR`，以及桌面产品与 runtime closure 中的 `@wecom/cli` 与平台 optionalDependencies。钉钉 DWS 与微信助理 iLink 仍为在线连接通道。

本变更合并并取代同批删除的「桌面企业微信 CLI 技能」Agent Note。原动机是 WorkBuddy 式「连接」加官方 CLI 技能、免去单独 `npm install -g`；产品方向已不再需要该面，因此放弃能力，而不是继续以隐藏 Client 过滤方式休眠保留。

## 考虑过的替代方案

**Client 继续隐藏，但保留 Host RPC 与随包 CLI。** 否决：安装包仍会膨胀，且维护无人使用的授权与技能代码。

**仅保留企业微信为演示目录卡片。** 否决：卡片已暗示真实通道，而半实现的打包才是成本所在。

## 后果

桌面构建不再下载企业微信技能，也不再随包 `@wecom/cli`。此前在本机授权过 wecom-cli 的用户仍可能留下 `~/.config/wecom` 凭据，需自行清理；产品不再读取或安装 `$DSH_HOME/skills` 下的 `wecomcli-*`。若要重新引入，需要新的功能决策与全新打包。连接器包测试断言目录中无「企业微信」行。第三方声明去掉 `@wecom/cli*`。
