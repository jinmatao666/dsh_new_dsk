# Agent Note: Permit the HTTP expert gateway in the macOS WebView

Status: implemented

English | [中文](2026-09-29-macos-http-expert-webview.zh.md)

## Problem

The expert gateway uses HTTP at `ac.zjugis.com:3300`. Safari can reach an expert page, but the macOS desktop child WKWebView can remain blank because App Transport Security blocks insecure HTTP loads by default. The desktop's per-launch origin permission does not override this native network policy.

## Decision

The desktop's macOS `Info.plist` adds `NSExceptionAllowsInsecureHTTPLoads` for the exact domain `ac.zjugis.com`. Tauri merges this file into the application bundle. The application still authorizes each child WebView for the selected expert's exact origin and uses its one-use identity ticket.

## Alternatives considered

Enabling arbitrary insecure web content globally was rejected because it would allow unrelated HTTP hosts. Requiring HTTPS immediately was not possible for the current gateway deployment; when HTTPS is available, remove the domain exception.

## Consequences

HTTP expert content can load in the macOS WKWebView, but traffic to the gateway remains unencrypted. A Mac installer must be rebuilt, and an installed Mac must verify ticket redemption and expert rendering; plist validation on Windows alone does not prove that the observed blank page has this sole cause.
