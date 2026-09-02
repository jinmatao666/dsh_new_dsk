# Agent Note: 在浏览器下载前获取会话归档

Status: implemented

[English](2026-09-02-session-log-export-archive-download.md) | 中文

## 问题

Session log 操作原先通过 `HEAD` 请求确认导出端点存在，再将端点 URL 交给 HTML 下载锚点。桌面 WebView 可能接受该点击却不创建保存文件，因此界面显示成功时实际上还没有传输 ZIP 归档。

## 决策

`dsh-session-log-export` 现在使用 `GET` 请求导出端点，等待收到 ZIP 字节后创建 Blob URL，再触发浏览器下载操作。临时 Blob URL 会在操作后释放。只有归档响应已经接收并交给下载管理器后才显示成功；HTTP 与传输失败仍显示现有错误对话框。

## 备选方案

**保留 `HEAD` 校验后使用 URL 锚点。** 不予采用，因为它只能校验端点可用，不能证明已经获取归档，也不能证明桌面 WebView 已保存文件。

**增加仅桌面端可用的原生导出命令。** 不予采用，因为 Session log 客户端同样运行在浏览器端。获取归档字节并使用 Blob URL 可让两个界面使用同一条导出路径，而无需增加外部 sidecar IPC 授权。

## 影响

导出会在完整 ZIP 响应返回后才显示成功，因此大型归档的“正在准备”状态会比原先仅发请求头时更久。用户得到的是由真实归档字节支撑的下载操作，而不是未经验证的端点 URL。
