# Agent Note: Monterey browser compatibility in desktop builds

Status: implemented

English | [中文](2026-11-03-monterey-browser-compatibility.zh.md)

## Problem

An M1 Mac running macOS 12.6.6 displayed a blank desktop window and a blank local browser page. The Sidecar announced its listening URL and cookie cleanup finished. No renderer error was available, so the exact original exception remains unconfirmed.

## Decision

The Wanwei product build transforms the shell's JS/CSS and fetched plugin JS/CSS artifacts for Safari 15.6 after the upstream build. A blocking classic script installs `core-js/stable` before module evaluation. This covers newer APIs used by client plugins, including `Promise.withResolvers`, array search/copy methods and structured cloning. Node bundles and upstream source files are unchanged. The compatibility dependency and build tooling belong to the private desktop product.

An empty root gets a reload prompt after an early loading error or thirty seconds. Error messages and token-bearing URLs are not rendered. Existing rendered content is retained.

## Alternatives considered

**Require an upgraded browser.** The desktop uses the operating system WebView, independently of installed Chrome. The product build therefore supplies compatible syntax and missing standard APIs while leaving shared Node artifacts intact.

## Consequences

Node regressions remove modern APIs before executing the generated bootstrap and a fetched CommonJS plugin, verify structured Map cloning, CSS nesting/static block lowering, unchanged Node artifacts, idempotent HTML injection and the reload prompt. The compatibility pass also completes over the current local browser artifacts. These checks do not establish installed macOS 12.6.6 compatibility or prove the original root cause. Rebuild and test on the affected Mac; Windows installed-package acceptance remains required because the generated browser assets are shared.
