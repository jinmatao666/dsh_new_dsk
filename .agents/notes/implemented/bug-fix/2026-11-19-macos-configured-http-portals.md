# Agent Note: macOS configured HTTP portals use the WebView transport exception

Status: implemented

English | [中文](2026-11-19-macos-configured-http-portals.zh.md)

## Problem

Land market and planning lecture load administrator-configured addresses in WKWebView frames. The native bundle has an HTTP exception for `ac.zjugis.com`, but configured IP hosts and other HTTP domains fall outside that exception and can be blocked by App Transport Security.

## Decision

The macOS source plist enables `NSAllowsArbitraryLoadsInWebContent` for the WebViews that display configured portals and experts. The existing gateway exception remains. The installer identity check requires the WebView key and rejects a global arbitrary-load exception. Tauri merges the source plist into both Mac architecture bundles.

The [expert WebView note](2026-09-29-macos-http-expert-webview.md) retains the independent ticket-bootstrap and hash-route decisions. This note owns the transport policy for runtime-configured addresses.

## Alternatives considered

**Adding fixed domain exceptions.** Administrators can select domains, IP hosts and ports after installation. A build-time host list cannot cover that deployment configuration.

**Requiring HTTPS.** Existing portal deployments use HTTP, and desktop configuration already accepts those addresses.

## Consequences

Configured HTTP pages and their requests can load under WKWebView. Their traffic remains unencrypted. The native URLSession policy retains its existing exceptions. A rebuilt Mac installer and installed-device verification are required; plist parsing and configuration checks on Windows cannot establish successful rendering or ticket redemption on macOS.
