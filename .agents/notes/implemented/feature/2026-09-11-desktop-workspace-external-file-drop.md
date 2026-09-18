# Agent Note: Desktop Workspace External File Drop

Status: implemented

English | [中文](2026-09-11-desktop-workspace-external-file-drop.zh.md)

## Problem

Desktop users can open an existing Workspace but cannot put a file from the operating system into it without leaving the application. Chat image attachments do not solve that problem: they are durable conversation input rather than files the current Workspace and its tools can use.

## Decision

The desktop shell accepts operating-system file and directory drops for the active Session. The main `WebviewWindow` consumes Tauri's window-level `DragDropEvent` stream; Wry synthesizes drops for a window-content WebView as window events rather than webview events. Tauri retains the paths from one native drop, and the renderer consumes that batch exactly once without asking WebView to materialize browser `File` bytes. The native shell canonicalizes the destination and sources, recursively copies ordinary files and directories into the Session Workspace or the app-local default import directory when the Session has no Workspace, and rejects symbolic links and special files. It accepts at most 64 files across the complete drop, 64 MiB per file, and 256 MiB in total. Existing entries remain unchanged; a conflicting top-level name receives a numeric suffix.

The native drop is replaced by a later drop and removed before copying begins, so a page cannot replay it or supply arbitrary source paths. The operation does not contact One API or persist a chat attachment. Browser deployments have no bridge and report that direct import is unavailable. A copied top-level file or directory is inserted into the composer as a structured reference with the standard file or folder presentation and serializes to its Workspace-relative `@` mention.

The active Session cwd selects the Workspace destination. A Session without a cwd uses the desktop app's local default import directory, preserving the draft in the same Session while making the copied file available by its appended reference.

The desktop window capability explicitly authorizes both import paths: `import_workspace_files` for browser-provided bytes and `import_dropped_workspace_files` for retained operating-system paths. The full-window drop overlay names both images and ordinary files; it keeps image limits visible and explains that ordinary files are copied into the Workspace.

## Alternatives considered

**Send dropped files to the server.** The Workspace is local to the desktop host, while uploading to One API would create remote retention and authorization behavior unrelated to local file import.

**Treat every drop as a chat attachment.** A conversation image reference does not place an ordinary file in the Workspace where tools expect it, and it would exclude non-image files.

**Read browser `File` bytes before invoking Tauri.** Windows WebView2 can invalidate a path-backed `File` before `arrayBuffer()` finishes, which rejects a valid operating-system drop before the native shell sees it.

## Verification

Attachment UI tests exercise native drag visibility and one drop consumption. Native tests pin file and recursive directory copying, collision suffixes, and limits.

## Consequences

Desktop drops work for ordinary documents, images, and bounded directory trees without changing the One API service or image-attachment protocol. Command registration and window ACL authorization remain paired, so a registered import command cannot fail only when the renderer invokes it.
