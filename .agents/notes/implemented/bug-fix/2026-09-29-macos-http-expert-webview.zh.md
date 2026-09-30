# Agent Note: 允许 macOS WebView 加载 HTTP 专家网关

Status: implemented

[English](2026-09-29-macos-http-expert-webview.md) | 中文

## Problem

专家网关在 `ac.zjugis.com:3300` 使用 HTTP。Safari 可以访问专家页面，但 macOS 桌面端的子 WKWebView 可能因 App Transport Security 默认阻止不安全的 HTTP 加载而保持空白。桌面端按每次打开授权网页来源，并不能覆盖这项原生网络策略。

## Decision

桌面端的 macOS `Info.plist` 仅为 `ac.zjugis.com` 域名添加 `NSExceptionAllowsInsecureHTTPLoads`。Tauri 将该文件合并进应用安装包。应用仍按所选专家的准确来源授权子 WebView，并使用一次性身份票据。

## Alternatives considered

没有采用全局允许不安全网页内容，因为那会允许无关的 HTTP 主机。当前网关部署暂时无法立即要求 HTTPS；具备 HTTPS 后应移除这一域名例外。

## Consequences

macOS WKWebView 可以加载 HTTP 专家内容，但与网关之间的传输仍未加密。必须重新构建 Mac 安装包，并在已安装的 Mac 上验证票据核验和专家页面显示；Windows 上的 plist 校验不能证明截图中的空白仅由这一原因造成。
