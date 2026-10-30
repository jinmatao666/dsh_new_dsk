# Agent Note: 知识库卡片、问答开关与文件分页

Status: implemented

[English](2026-10-30-knowledge-library-cards-qa-toggle-and-file-pagination.md) | 中文

## Problem

桌面知识库页侧栏只有名称、文件数量和描述的小卡片，而广场卡片展示封面、分类、维护者、更新时间、文件数量、大小和订阅人数。问答栏始终展开，旁边的内容栏宽度需要用户拖动调整，文件列表起始很窄。列表没有分页，搜索只是图标开关，没有上传时间和上传人，侧栏也无法按名称查找知识库。

## Decision

问答默认关闭，文件内容铺满宽度。侧栏每个知识库是一张卡片，含选择按钮和独立的问答开关。选择按钮展示广场封面、分类标签（管理员分类名称；无分类的库显示 个人 / 共享 / 公共）、「我的」或「已订阅」状态标签、名称、描述，以及广场的 `renderPlazaMeta` 行。开关打开或关闭所选知识库的问答栏；对另一个知识库按下时，先选中该库再打开问答栏。问答栏打开时页面是三列网格，文件网格收为一列。拖动分隔条、其键盘处理和 `调整内容宽度` 一并移除。

`GET /api/knowledge/bases` 为每个桌面条目增加 `owner_username`、`document_bytes` 和 `subscriber_count`，复用广场的数据来源：`plazaDatasetStats` 提供文件数与字节数，`userDisplayNames` 和 `knowledgeUserSubscriberCounts` 提供维护者与订阅人数。`fillDesktopDocumentCounts` 由 `fillDesktopCatalogMeta` 与 `fillDesktopDocumentStats` 取代。页面保存本次会话文档加载得到的 `documentStats`，并对所选知识库优先使用它而不是列表值。

RAGFlow 不返回上传人，因此 OneAPI 在 `uploadKnowledgeDocument` 或把文件复制、移动到知识库时，把上传人记入 `knowledge_document_creators`（`knowledge_base_id`、`document_id`、`user_id`）。转存的副本保留源文件的上传人，源文件没有记录时记为调用者。删除、移出、替换和删除知识库都会清除对应行。`applyKnowledgeDocumentCreators` 为文档列表加上 `creator_name`，上传人是调用者或未知时省略。因此桌面只对他人的文件显示创建人。

侧栏搜索框跨分组按名称过滤知识库，展开有命中的分组，无命中时显示「没有匹配的知识库」。内容工具栏有始终可见的文件名称搜索，以及在「最新上传」和「最早上传」之间切换的按钮。分页按顶层文件夹和文件切片（每页 12 项，`DOCUMENT_PAGE_SIZE`）；文件夹的子项留在它所在的页。分页条对齐技能市场目录样式：上一页/下一页、「第 N 页 / 总页数」、带省略号的页码按钮和跳转输入。它占据内容区网格最后一行，列表在其上方滚动；`.dsh-knowledge` 使用 `grid-template-rows: minmax(0, 1fr)`，并对子项设置 `min-height: 0`，避免内容列超出视口把分页裁掉。搜索、排序或知识库变化后回到第 1 页。文件卡片显示上传时间（`YYYY-MM-DD HH:mm`）和创建人。

## Alternatives considered

用 RAGFlow 文档的 `created_by` 得到创建人 — 否决；所有上传都使用共享服务账号，它不指向任何用户。把上传人存入已有的 `knowledge_document_paths` 表 — 否决；路径只为文件夹上传保存，且有各自的生命周期。让整张侧栏卡片成为一个按钮、问答开关嵌在其中 — 否决；嵌套按钮是无效 HTML，并破坏键盘和读屏使用。按展平后的文件数分页 — 否决；它会把展开的文件夹拆到多页。在开关旁保留可调内容栏 — 否决；需求要求移除，单列列表也没有宽度可调。

## Consequences

打开页面时，每个知识库最多产生十次 RAGFlow 分页请求（与广场相同），而不是一次。本次变更之前上传的文件在重新上传前不显示创建人。没有这些字段的服务端会让新增的元数据行显示为 0 和「未知作者」；没有这些字段的客户端会忽略新增的 JSON 字段。本变更取代[侧栏计数笔记](2026-10-30-knowledge-sidebar-counts-and-content-cards.zh.md)中的侧栏卡片布局、计数来源和网格宽度；该笔记中的文件夹卡片设计和已否决的备选方案仍然适用。
