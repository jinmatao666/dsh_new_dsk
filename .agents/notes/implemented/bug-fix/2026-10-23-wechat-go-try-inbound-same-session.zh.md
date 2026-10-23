# Agent Note: 微信「去试试」与入站共用同一 Session 视图

Status: implemented

[English](2026-10-23-wechat-go-try-inbound-same-session.md) | 中文

## Problem

打包桌面端在「去试试」打开微信助理会话后，手机发送如「打开百度地图」不会出现在该会话聊天里。Host 入站桥接仍可运行并在微信侧回复，缺陷在 Client/Host 的 Session 身份与选中态，而非 iLink 投递。

## Decision

保持 `wechat-workspace` 下唯一持久 Session，并让「去试试」与入站 prompt 落到同一 id、同一 Client 视图：

- 同一产品 home 上并发的 `ensureWeChatDesktopSession` 共用一个 in-flight Promise，避免桥接启动与 Client `ensureSession` 各建一个 Session 并互相覆盖 `desktop-session.json`。
- 「去试试」/绑定成功：`ensureSession` → 刷新列表 → `sessions.open`（未知 id 再刷一次再打开）；失败时只暂存示例草稿，**不要** `sessions.clear()`（clear 会藏起 Host 侧回合）。
- 固定 Session 列表行进入 `running` 且当前未选中时打开它；status 为 `authed` 但缺 `sessionId` 时，输入框连接器芯片调用 `ensureSession`，让聚焦规则拿到 id。
- 侧边栏删除只是归档，会话仍可恢复，因此 `ensureWeChatDesktopSession` 跳过 `workspaceRegistry.archivedSessionIds` 中的所有 id（含保存的指针），新建干净的微信助理 Session，而不是复活已删除的历史。
- 绑定成功时只选中 Session、不关闭连接器面板，面板内的「微信助理已连接」提示才能显示；「去试试」仍会关闭面板。
- `ensureWeChatDesktopSession` 仅在 `session-not-found` 时替换候选；其他恢复失败直接抛错，不再新建第二个 Session。标题只在创建时设置一次，入站消息不再每次追加 `session/title` 事件。
- 桥接已用同一 bot token 轮询时 `startWeChatBridge` 不做任何事，反复的 `loginPoll` / `status` 不会中断进行中的手机任务。被替换的桥接循环不发 `notifystop`；只有真正停止才用该循环自己的凭据宣告离线。空文本回复失败不再终止循环，`status` 会重启已退出的循环。

## Alternatives considered

**由 Client 创建 Session 再把 id 传给桥接：** 否决——无 Client 打开时入站也须可用；Session 权威仍在 Host。

**打开失败后清空选中、只靠暂存草稿：** 否决——正是「去试试」空视图而 Host 写入另一 Session 的路径。

## Consequences

Host 测试覆盖并发 ensure 合并为一次 `create`、复用时不重命名、已归档指针被替换、恢复瞬时失败时不创建，以及重复启动桥接只有一次 `notifystart`、被替换循环不发 `notifystop`。Client 打开失败不再清空选中。产品规则仍见[微信助理 iLink 通道](../feature/2026-10-19-wanwei-wechat-assistant-ilink.zh.md)。打包桌面需带上本次 Host+Client 改动后再复测。
