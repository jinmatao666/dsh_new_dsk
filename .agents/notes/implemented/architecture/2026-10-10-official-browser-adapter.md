# Agent Note: Official browser provider on the Wanwei runtime

Status: implemented

English | [中文](2026-10-10-official-browser-adapter.zh.md)

## Problem

The official browser provider expects awaited Agent creation and a working-directory service. This desktop runtime emits creation synchronously and records workspace directories in Session headers. Direct installation can race the first model request and cannot resolve the required directory service.

## Decision

A private browser plugin mounts the unmodified official npm provider at version `0.2.1-alpha.2`. A provider-local Context supplies the validated Session directory and initialization signal. Prompt assembly waits and recollects the tool catalog after registration. Cancellation of a turn stops its wait without transferring ownership of the Session browser; disposal aborts and awaits startup. A plugin-owned Settings card persists `wanwei-browser-use.enabled`, defaulting to enabled; `DSH_BROWSER_USE_ENABLED=0` sets the composition default, with an optional `DSH_BROWSER_EXECUTABLE`. Disabling hides schemas and blocks subsequent calls without terminating running operations. Disabled or intranet Sessions defer initialization until an allowed prompt assembly; saved permission survives restart and is not overwritten by network mode.

The product resolves an explicit executable first, otherwise checks standard installed Chrome/Edge locations (Linux also checks Chromium on PATH), and passes the selected path into the unmodified provider. An invalid explicit path fails configuration; missing automatic discovery denies browser calls with Chinese feedback. Recognized startup failures retain upstream diagnostics after corrective tool feedback. Logged prompt guidance prohibits model-led installation or shell/CDP workarounds and requests user intervention for captchas; this is not shell-level enforcement. The resolver never downloads a browser and selection changes require a restart/new Session.

## Alternatives considered

**Upgrade the full runtime.** This changes unrelated product lifecycle and package APIs; the current browser requirement does not justify that scope.

**Modify official browser source.** A copied fork makes each upstream update a merge. The provider-local adapter keeps the published code unchanged.

## Consequences

The configured server owns `plugins.browserAssistant` independently of personal settings. The authentication plugin validates and commits its permission on deployment refresh; the browser adapter reads it before initialization, schema discovery and direct execution. Administrator denial locks the Client switch without writing the saved preference. Before the first successful refresh permission is denied; later refresh failures retain the last confirmed value. Missing plugin fields from older servers resolve to enabled. The policy uses the existing refresh schedule rather than a push channel, so revocation is effective after refresh and does not terminate an executing operation. Older desktop binaries do not implement administrator enforcement.

The desktop composition mounts the plugin with an enabled default, while saved choices and intranet denial remain authoritative. The settings card uses a collapsed title/description header and an expanded automatically saved switch, matching neighboring plugin disclosure without introducing staged preference state. Disclosure alone never writes settings.

The shared Agent registry and loop stay unchanged. Fixed published packages require narrow peer-version acceptance and integration tests against the local services. Pure intranet mode denies all browser tools until browser-network confinement is available; URL checks alone cannot constrain redirects and subresources. The package does not download Chromium. Installed-desktop model-driven validation and platform packaging verification remain incomplete. The card uses the existing settings slot and locale services; no official settings component is forked.

## Verification

Deployment tests reject malformed plugin flags and retain explicit denial. Client tests verify administrator locking and restoration of personal preferences. The real Loader/browser composition also denies direct calls after administrator revocation, then verifies that administrator re-enabling does not override a personal disable.

The desktop production deploy root depends on the Wanwei bundle so the pinned browser packages and their transitive npm dependencies are staged by pnpm. Workspace restoration alone supplies no registry packages. The packaged-profile startup check uses bundled Node without workspace resolver anchors.

Focused tests exercise startup readiness, schema recollection, canceled waits, failed startup, deferred initialization, persisted permission and intranet direct-call denial. Card tests cover disable writes, intranet state and save failures. A real Loader composition starts the pinned MCP and installed Chromium, denies navigation while disabled, re-enables navigation to `about:blank`, verifies file persistence and checks scope cleanup. This is tool-executor validation, not a paid model-driven conversation.

Executable-resolution tests cover standard-location order, Edge fallback, absent browsers and explicit paths. Feedback tests pin the Chinese startup failure result and policy disposal. On Windows the real Loader test omits an executable path, runs headed Chrome, and exercises navigation, form input, button click and result readback against an offline fixture. macOS/Linux discovery is not established by this Windows browser run.
