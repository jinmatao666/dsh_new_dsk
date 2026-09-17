# Agent Note: Desktop Workspace Directory Open

Status: implemented

English | [中文](2026-09-17-desktop-workspace-directory-open.zh.md)

## Problem

The Workspace row offered **Open workspace**, but the desktop renderer delegated the action to the Node sidecar's generic `host.openPath` implementation. A failed native handoff was written only to the renderer console, so clicking the menu item could leave the user with no opened directory and no visible failure.

## Decision

The installed desktop shell opens Workspace directories through a narrow Tauri command. The command verifies that the supplied Workspace path exists and is a directory, then starts the platform file manager without a shell. Windows uses `explorer.exe`, macOS uses `open`, and Linux uses `xdg-open`.

The Workspace UI prefers this command when the desktop bridge is present. Browser and remote compositions retain `host.openPath` as their fallback. Either path reports a failed open in the Workspace panel instead of relying on console output.

## Alternatives considered

**Keep every open through `host.openPath`.** Rejected for the installed desktop because the extra renderer-to-sidecar handoff is unnecessary for an operation the native shell owns, and its failure was not observable in the product UI.

**Open every file through Tauri.** Rejected because produced-file links and browser deployments already rely on the Host opener's cross-platform file-association behavior. The native command is limited to Workspace directories.

## Consequences

The desktop menu opens the directory from the process that owns the visible window, while non-desktop clients preserve their existing Host behavior. The renderer has one additional desktop command dependency, and unsupported or inaccessible paths produce a visible error.
