# Agent Note: Official browser provider on the Wanwei runtime

Status: implemented

English | [中文](2026-10-10-official-browser-adapter.zh.md)

## Problem

The official browser provider expects awaited Agent creation and a working-directory service. This desktop runtime emits creation synchronously and records workspace directories in Session headers. Direct installation can race the first model request and cannot resolve the required directory service.

## Decision

A private browser plugin mounts the unmodified official npm provider at version `0.2.1-alpha.2`. A provider-local Context supplies the validated Session directory and initialization signal. Prompt assembly waits and recollects the tool catalog after registration. Cancellation of a turn stops its wait without transferring ownership of the Session browser; disposal aborts and awaits startup. A plugin-owned Settings card persists `wanwei-browser-use.enabled`, defaulting to enabled; `DSH_BROWSER_USE_ENABLED=0` sets the composition default, with an optional `DSH_BROWSER_EXECUTABLE`. Disabling hides schemas and blocks subsequent calls without terminating running operations. Disabled or intranet Sessions defer initialization until an allowed prompt assembly; saved permission survives restart and is not overwritten by network mode.

## Alternatives considered

**Upgrade the full runtime.** This changes unrelated product lifecycle and package APIs; the current browser requirement does not justify that scope.

**Modify official browser source.** A copied fork makes each upstream update a merge. The provider-local adapter keeps the published code unchanged.

## Consequences

The shared Agent registry and loop stay unchanged. Fixed published packages require narrow peer-version acceptance and integration tests against the local services. Pure intranet mode denies all browser tools until browser-network confinement is available; URL checks alone cannot constrain redirects and subresources. The package does not download Chromium. Installed-desktop model-driven validation and platform packaging verification remain incomplete. The card uses the existing settings slot and locale services; no official settings component is forked.

## Verification

Focused tests exercise startup readiness, schema recollection, canceled waits, failed startup, deferred initialization, persisted permission and intranet direct-call denial. Card tests cover disable writes, intranet state and save failures. A real Loader composition starts the pinned MCP and installed Chromium, denies navigation while disabled, re-enables navigation to `about:blank`, verifies file persistence and checks scope cleanup. This is tool-executor validation, not a paid model-driven conversation.
