# Agent Note：桌面端启动时清理遗留的浏览器认证 Cookie

Status: implemented

[English](2026-10-29-desktop-auth-cookie-overflow.md) | 中文

## 问题

桌面端 Sidecar 启动时选择可用的本地回环端口。浏览器认证 Cookie 名包含请求端口，但 WebView2 会按主机发送 Cookie，不区分端口。反复启动后，遗留 Cookie 可能使请求头超过本地 HTTP 服务的限制，令牌交换尚未发生便返回 HTTP 431。

## 决定

原生主窗口先打开 `about:blank` 并保持隐藏。后台线程枚举 Sidecar 地址对应的 Cookie，删除名称以 `dsh-auth-` 开头的条目，再访问本次启动输出的带令牌地址并显示窗口。WebView2 异步完成 Cookie 枚举，因此不在 Windows UI 线程执行。清理失败会记录日志，但不记录令牌值。

## 考虑过的方案

**删除整个 WebView 配置目录。** 这会同时清掉无关的浏览器状态，影响范围更大。

**增大 HTTP 请求头限制。** 这会允许 Cookie 继续累积，并影响本地服务的所有请求。

## 结果

清理后通过本次 Sidecar 启动令牌重新建立认证，工作区数据不受影响。原生编译验证了 API 调用；仍需用已积累 Cookie 的 Windows 安装环境验证启动结果。
