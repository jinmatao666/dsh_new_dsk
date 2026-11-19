# Agent Note: macOS 配置的 HTTP 门户使用 WebView 传输例外

Status: implemented

[English](2026-11-19-macos-configured-http-portals.md) | 中文

## Problem

土地市场和资规讲坛在 WKWebView 框架内加载管理员配置的地址。原生安装包为 `ac.zjugis.com` 提供 HTTP 例外，但配置的 IP 主机和其他 HTTP 域名不属于该例外，可能被 App Transport Security 阻止。

## Decision

macOS 源 plist 为展示配置门户和专家的 WebView 启用 `NSAllowsArbitraryLoadsInWebContent`，并保留既有网关例外。安装包身份检查要求该 WebView 配置，同时拒绝全局任意加载例外。Tauri 将源 plist 合并进两种 Mac 架构的安装包。

[专家 WebView 记录](2026-09-29-macos-http-expert-webview.zh.md)保留独立的票据初始化和 hash 路由决策。本文负责运行时配置地址的传输策略。

## Alternatives considered

**增加固定域名例外。** 管理员在安装后可以选择域名、IP 主机和端口，构建时的主机清单无法覆盖这些部署配置。

**要求 HTTPS。** 现有门户通过 HTTP 部署，桌面配置也已接受这些地址。

## Consequences

配置的 HTTP 网页及其请求可以在 WKWebView 内加载，传输仍为明文。原生 URLSession 策略沿用既有例外。需要重新构建 Mac 安装包并在安装设备上验证；Windows 上的 plist 解析和配置检查无法证明 macOS 的页面渲染与票据兑换成功。
