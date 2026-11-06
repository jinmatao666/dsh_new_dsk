# Agent Note: 桌面知识库上传仅限个人库

Status: implemented

[English](2026-11-06-desktop-knowledge-upload-personal-only.md) | 中文

## 问题

桌面知识库内容工具栏对所有选中库展示同一上传菜单，调用者在「公共知识库」与「订阅知识库」也能打开上传，尽管这些入口不可由调用者写入。个人库上传菜单还列出多项未接入来源，入口显得杂乱。

## 决策

`libraryIsDesktopPersonal` 仅对未归类个人库为真（`kind === 'personal'` 且 `category_id` 缺省或为 0）——与侧栏「个人知识库」行一致。`libraryAllowsDesktopUpload` 委托该谓词。内容工具栏仅在该条件成立时渲染上传控件，选中离开个人库时关闭已打开菜单。个人库菜单保留「本地文件」、「网页链接」（见 [桌面知识库网页链接导入](2026-11-06-desktop-knowledge-web-link-import.zh.md)）与「录音纪要」（见 [桌面知识库录音纪要](2026-11-06-desktop-knowledge-recording-minutes.zh.md)）。从个人知识库导入、笔记、腾讯文档、本地文件夹与新建空文件夹入口保持隐藏。文件右键删除使用同一按个人分组谓词（见 [桌面知识库文件右键仅删除](2026-11-06-desktop-knowledge-file-context-delete-only.zh.md)）。

## 考虑过的替代方案

**只隐藏会调用 `api.upload` 的项，按钮仍留给占位来源。** 否决；只读库上仍显示上传入口会暗示调用者可以添加内容。

**按任意 kind 的 `owned_by_viewer` 放开上传。** 否决；侧栏公共与订阅分组即使浏览到自己拥有的行也不得显示上传——产品规则按分组，且个人库本身已是所有权范围。

## 后果

选中公共或订阅库时工具栏不再出现上传按钮。针对性 Client 测试覆盖个人库三项菜单，以及公共与订阅选中时控件隐藏。
