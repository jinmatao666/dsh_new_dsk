# 知识库 PDF 封面

Status: implemented

[English](2026-11-16-knowledge-pdf-covers.md) | 中文

OneAPI 在上传或转移 PDF 后将封面任务入队。数据库租约使工作进程可以恢复中断的任务，同时防止租约已过期的工作进程覆盖当前结果。Poppler 只渲染首页，生成的 JPEG 按知识库和文档编号保存。列表返回封面已就绪后，桌面端才请求图片。封面接口在返回图片前检查知识库访问权限和付费预览资格。

OneAPI 容器包含 Poppler。独立部署须在服务进程的 PATH 中提供 `pdftoppm`。没有封面任务的历史文件使用占位图。
