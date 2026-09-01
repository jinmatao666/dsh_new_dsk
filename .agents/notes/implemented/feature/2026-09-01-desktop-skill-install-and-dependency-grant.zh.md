# Agent Note: Desktop skill installation and dependency grant

Status: implemented

[English](2026-09-01-desktop-skill-install-and-dependency-grant.md) | 中文

## Problem

桌面端用户需要在技能广场中安装技能，并让本地运行时能够发现它。Workspace Write 会话还需要在首次下载缺失依赖时征得用户确认，同时避免同一任务中不断重复打断用户。

## Decision

桌面端技能广场通过 Tauri 原生命令，将已安装技能写入当前用户的 `.dsh/skills/<slug>/SKILL.md`。文件系统技能提供方已监听该用户目录，因此新建对话会通过常规目录发现已安装技能，并可用生成的 `/market-<slug>` 名称调用。删除使用相同的受限目录，并拒绝符号链接目标。

`ApprovalService` 可选择在一个存活会话中记住已允许的软件包管理器升权。它只识别记录在 `bash` 或 `pwsh` 工具调用中的 `pip`、`npm`、`pnpm` 和 `yarn` 安装命令。第一个匹配的升权仍进入正常人工审批；后续匹配升权在内存中自动允许，不再次弹窗。桌面端通过 `DSH_DEPENDENCY_INSTALL_APPROVALS=session-once` 启用此选项。

交付物行排除辅助源码扩展名，并只使用成功的文件变更位置或终端明确写入输出作为依据，不从助手文本推断产物。

## Alternatives considered

**仅在浏览器存储中记录安装状态** — 不采用。浏览器标记无法将技能放入主机目录，也无法使新对话的目录发现到该技能。

**首次依赖批准后允许所有后续沙箱升权** — 不采用。依赖安装授权不能扩展为与安装无关的命令或文件操作授权。

**跨会话记住依赖授权** — 不采用。新任务应重新获得用户决定，持久化授权还会带来撤销与审计要求。

## Consequences

技能广场安装的技能仅属于本机桌面端用户，并在下次对话的目录获取时可用。非桌面浏览器仍可渲染技能广场，但安装操作会提示原生安装不可用。

依赖便利只在已有升权路径后生效，不改变完全权限行为，也不放宽会话的通用沙箱策略。

## Verification

聚焦审批和交付物测试覆盖会话授权与辅助源码排除。类型检查覆盖技能广场、审批和交付物包；`cargo check` 覆盖桌面端原生命令。
