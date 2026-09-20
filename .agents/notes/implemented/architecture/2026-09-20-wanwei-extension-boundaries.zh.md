# 万维扩展边界

[English](2026-09-20-wanwei-extension-boundaries.md) | 中文

官方浏览器包提供不含产品语义的平台动作注册表和成果扩展注册表。产品外壳通过注册表提供原生目录打开、原生文件保存、额外成果解析和成果展示组件。

万维层拥有 Tauri 命令映射、`WANWEI_RESULT` 解析、分析成果展示、OneAPI 视觉 Provider 和技能市场。这些实现位于 `packages/wanwei`，只通过万维 Bundle 进入应用。

这一结构使官方 Workspace、Session 导出和 Deliverables 包在没有桌面 Provider 时仍可使用。缺少 Provider 时，可选动作不显示或回退到浏览器下载；官方运行时成果识别也不再依赖私有协议标记。

后续更新上游时，应保留这两个通用注册表，或者替换为上游提供的等价扩展点。产品协议和原生命令的变化必须继续留在万维包中。
