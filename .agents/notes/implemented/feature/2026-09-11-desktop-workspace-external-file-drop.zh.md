# Agent Note: Desktop Workspace External File Drop

Status: implemented

[English](2026-09-11-desktop-workspace-external-file-drop.md) | 中文

## Problem

桌面端用户能够打开已有 Workspace，却不能在不离开应用的情况下把操作系统中的文件放入其中。聊天图片附件无法解决这个问题：它们是持久化的会话输入，而不是当前 Workspace 及其工具可使用的文件。

## Decision

当当前 Session 属于已登记的 Workspace 时，桌面端 Workspace 侧边栏接受来自操作系统的文件拖放。浏览器读取被拖入的文件字节，并携带该 Workspace 路径调用仅供 Tauri 使用的 `import_workspace_files` 命令。原生壳会规范化根目录、只接受基础文件名，并在该目录中创建新文件。每次最多接收 64 个文件、单个文件最多 64 MiB、总量最多 256 MiB。已有文件保持不变；同名文件会追加数字后缀。

面向用户的导入路径只在用户主动拖放时接收文件字节，并写入当前已登记 Workspace 的直接子项。它不会访问 One API，也不会持久化聊天附件。普通浏览器部署没有该桥接能力，并会提示直接导入不可用。目录拖放不会表示为文件对象，仍不受支持。

Workspace 关联规则与 [Workspace UI Complete Product Flow](2026-07-25-workspace-ui-product-flow.md) 一致：选中的 Session 必须位于 Workspace 索引中，且 cwd 与该 Workspace 相同。未分组 Session 没有已登记的目标目录，不能接收拖放。

## Alternatives considered

**将拖入文件发送给服务器。** Workspace 位于桌面端主机本地；上传到 One API 会引入与本地文件导入无关的远程保留和授权行为。

**把每一次拖放都当作聊天附件。** 会话图片引用不会把普通文件放入工具预期的 Workspace，同时还会排除非图片文件。

**把源路径交给原生复制命令。** 浏览器拖放数据不能以可移植方式提供源路径；传入用户所选的字节可适用于所有允许的文件类型，也能使传输内容明确。

## Verification

Workspace 浏览器测试覆盖了向已选中 Workspace 拖入文件以及没有 Workspace 时的拒绝。原生测试固定了同名后缀和路径穿越拒绝行为。

## Consequences

桌面端文件拖放支持普通文档和图片，不改变 One API 服务或图片附件协议。大批量文件和目录树仍需要未来明确的导入流程。
