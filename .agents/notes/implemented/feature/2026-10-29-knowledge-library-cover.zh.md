# Agent Note：知识库封面

Status: implemented

[English](2026-10-29-knowledge-library-cover.md) | 中文

## 问题

广场卡片共用一张预制风景图，知识库广场里的库不容易区分。在管理工作台新建或编辑知识库的人需要附上一张广场可以展示的图片，管理工作台的编辑对话框也需要能更换或清除这张图片。

## 决策

`knowledge_bases.cover` 保存可选的紧凑 JPEG 数据 URL。`POST /api/knowledge-bases`（桌面新建，以及管理工作台新建走同一处理函数并带上管理员标记）接受 `cover`。`PUT /api/knowledge-admin/bases/:id` 仅在请求带有 `cover` 时更新它：有图片则替换，空字符串则清除。省略 `cover` 时保留原值，包括只改名称或只改上架状态。OneAPI 接受空封面，或 PNG、JPEG、WebP、GIF 数据 URL，并保存不超过 60 KiB 的 JPEG 数据 URL。其余情况在调用 RAGFlow 之前以「封面图片无效」失败。管理工作台的新建和编辑对话框读取不超过 8 MB 的本地图片并发送该数据 URL。桌面端新建对话框不显示封面上传。广场卡片和详情在 `cover` 为 `data:image/` URL 时使用它，否则使用 `/knowledge-covers/plaza-natural-resources.jpg`。桌面当前知识库标题旁，以及管理工作台卡片角标，在有封面时使用同一张图。哪些库出现在广场见 [知识库订阅广场](2026-10-23-knowledge-library-subscription.zh.md)。

## 考虑过的替代方案

**把原图存到磁盘并提供 URL：** 不采用。技能和专家图片已经以数据 URL 存在行上，单独的资源路由还要在删除知识库时清理文件。

**每个知识库都必须有封面：** 不采用。已有记录以及只填名称的新建仍要能出现，并使用预制图片。

**在桌面端提供创建之后更换封面的控件：** 不采用。桌面页面没有知识库元数据编辑器。管理工作台的编辑对话框已经保存名称、描述和标签，且只有管理员能打开。

**在桌面端新建对话框显示封面上传：** 延期。封面设置暂留在管理工作台的新建和编辑对话框；桌面仍会在广场和已打开知识库标题旁展示已保存的封面。

## 后果

桌面端、管理工作台和 OneAPI 需要一起发布。AutoMigrate 为 `knowledge_bases.cover` 增加 text 列。广场和目录响应会带上每个已设封面的数据 URL。无论上传的是 PNG、WebP 还是 GIF，存下来的封面都是 JPEG 数据 URL。清除封面后，广场恢复预制图片。不是管理工作台管理员的人不能从桌面新建对话框设置或更改封面。

## 测试

`NormalizeKnowledgeCover`、创建时拒绝与保存、以及管理工作台更新时的替换、省略和清除，由 OneAPI 的 model 与 controller 测试覆盖。桌面页面测试断言新建无封面上传，并渲染广场封面。管理工作台页面测试在新建和编辑时提交封面。
