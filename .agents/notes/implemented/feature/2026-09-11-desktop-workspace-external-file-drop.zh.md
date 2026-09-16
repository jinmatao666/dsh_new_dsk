# Agent Note: Desktop Workspace External File Drop

Status: implemented

[English](2026-09-11-desktop-workspace-external-file-drop.md) | 中文

## Problem

桌面端用户能够打开已有 Workspace，却不能在不离开应用的情况下把操作系统中的文件放入其中。聊天图片附件无法解决这个问题：它们是持久化的会话输入，而不是当前 Workspace 及其工具可使用的文件。

## Decision

桌面壳为当前 Session 接受来自操作系统的文件拖放。主 `WebviewWindow` 消费 Tauri 的窗口级 `DragDropEvent` 事件流；Wry 会把窗口内容 WebView 的文件拖放合成为窗口事件，而不是 WebView 事件。Tauri 保留一次原生拖入提供的路径，页面仅可消费该批次一次，无需让 WebView 把浏览器 `File` 实体化为字节。原生壳会规范化目标与源路径，只接受普通文件，并把文件复制到 Session Workspace；Session 没有 Workspace 时则使用应用本地默认导入目录。每次最多接收 64 个文件、单个文件最多 64 MiB、总量最多 256 MiB。已有文件保持不变；同名文件会追加数字后缀。

后一次拖入会替换待处理批次，复制开始前批次即被移除，因此页面不能重复消费，也不能自行提供任意源路径。该操作不会访问 One API，也不会持久化聊天附件。普通浏览器部署没有该桥接能力，并会提示直接导入不可用。文件夹拖入仍不受支持。

当前 Session 的 cwd 决定 Workspace 目标。没有 cwd 的 Session 使用桌面应用本地默认导入目录，草稿留在同一 Session，并追加复制后文件的引用。

## Alternatives considered

**将拖入文件发送给服务器。** Workspace 位于桌面端主机本地；上传到 One API 会引入与本地文件导入无关的远程保留和授权行为。

**把每一次拖放都当作聊天附件。** 会话图片引用不会把普通文件放入工具预期的 Workspace，同时还会排除非图片文件。

**调用 Tauri 前读取浏览器 `File` 字节。** Windows WebView2 可能在 `arrayBuffer()` 完成前使路径型 `File` 失效，导致有效的操作系统拖入尚未到达原生壳便失败。

## Verification

附件界面测试覆盖了原生拖入提示与一次消费。原生测试固定了源文件复制、同名后缀、限制和文件夹拒绝行为。

## Consequences

桌面端文件拖放支持普通文档和图片，不改变 One API 服务或图片附件协议。大批量文件和目录树仍需要未来明确的导入流程。
