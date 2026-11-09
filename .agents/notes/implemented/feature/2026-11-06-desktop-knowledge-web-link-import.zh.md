# Agent Note: 桌面知识库网页链接导入

Status: implemented

[English](2026-11-06-desktop-knowledge-web-link-import.md) | 中文

## 问题

桌面个人知识库此前只能添加本地文件。调用者需要把公开网页链接（公众号、新闻、博客等）粘贴进知识库，由 RAGFlow 抓取并解析，并在发起网络请求前做客户端格式校验。

## 决策

个人库上传菜单打开「导入网页链接」对话框。文本框接受换行分隔的绝对 `http`/`https` URL（最多 10 条）。`packages/wanwei/knowledge-base/src/client/web-links.ts` 中的 `parseWebLinkInput` 用正则加 `URL` 解析拒绝空输入、超限、非 http(s) 协议、带凭证，以及 localhost/`.local` 主机。校验通过后调用 `KnowledgeApi.importWebLinks` → OneAPI-auth RPC `import-web-links` → `POST /api/knowledge-bases/:id/web-links`。控制器再次校验；OneAPI 经 SSRF 安全拨号（`resourcerelay.DialPublic`）抓取公开页面，把 HTML/PDF 字节按普通文件字段 `POST .../documents` 交给 RAGFlow，记录创建者并启动解析。仅未归类个人库可导入。

## 考虑过的替代方案

**依赖 RAGFlow `POST .../documents?type=web`。** 否决；现网 RAGFlow 忽略 `type=web` 并返回 `No file part!`，必须由 OneAPI 抓取后按本地文件上传。

**在桌面进程抓取页面再当文件上传。** 否决；浏览器侧抓取会撞 CORS，也绕过服务端 SSRF 策略。

**接受无协议域名并自动补 `https://`。** 否决；模糊输入会掩盖错误行，且与服务端绝对 URL 校验不一致。

## 后果

网页链接导入共用 [桌面知识库上传仅限个人库](2026-11-06-desktop-knowledge-upload-personal-only.zh.md) 的个人库上传门控。无效行留在对话框并显示行内错误；导入成功关闭对话框并刷新文档列表。HTML `<title>` 作为文档名保存（保留 `.html` 供类型识别，卡片标题去掉后缀）。内容卡片轮询 `run`/`progress`，解析中显示 `解析中…N% | HH:mm`；解析完成前预览问答不可用；HTML 在沙箱 iframe 中预览。录音纪要使用同一上传菜单（见 [桌面知识库录音纪要](2026-11-06-desktop-knowledge-recording-minutes.zh.md)）。
