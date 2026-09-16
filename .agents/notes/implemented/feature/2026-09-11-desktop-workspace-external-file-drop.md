# Agent Note: Desktop Workspace External File Drop

Status: implemented

English | [中文](2026-09-11-desktop-workspace-external-file-drop.zh.md)

## Problem

Desktop users can open an existing Workspace but cannot put a file from the operating system into it without leaving the application. Chat image attachments do not solve that problem: they are durable conversation input rather than files the current Workspace and its tools can use.

## Decision

The desktop shell accepts operating-system file drops for the active Session. The main `WebviewWindow` consumes Tauri's window-level `DragDropEvent` stream; Wry synthesizes file drops for a window-content WebView as window events rather than webview events. Tauri retains the paths from one native drop, and the renderer consumes that batch exactly once without asking WebView to materialize browser `File` bytes. The native shell canonicalizes the destination and sources, accepts regular files only, and copies them into the Session Workspace or the app-local default import directory when the Session has no Workspace. It accepts at most 64 files, 64 MiB per file, and 256 MiB per drop. Existing files remain unchanged; a conflicting filename receives a numeric suffix.

The native drop is replaced by a later drop and removed before copying begins, so a page cannot replay it or supply arbitrary source paths. The operation does not contact One API or persist a chat attachment. Browser deployments have no bridge and report that direct import is unavailable. Directory drops remain unsupported.

The active Session cwd selects the Workspace destination. A Session without a cwd uses the desktop app's local default import directory, preserving the draft in the same Session while making the copied file available by its appended reference.

## Alternatives considered

**Send dropped files to the server.** The Workspace is local to the desktop host, while uploading to One API would create remote retention and authorization behavior unrelated to local file import.

**Treat every drop as a chat attachment.** A conversation image reference does not place an ordinary file in the Workspace where tools expect it, and it would exclude non-image files.

**Read browser `File` bytes before invoking Tauri.** Windows WebView2 can invalidate a path-backed `File` before `arrayBuffer()` finishes, which rejects a valid operating-system drop before the native shell sees it.

## Verification

Attachment UI tests exercise native drag visibility and one drop consumption. Native tests pin source copying, collision suffixes, limits, and directory rejection.

## Consequences

Desktop file drops work for ordinary documents and images without changing the One API service or image-attachment protocol. Large batches and directory trees still require an explicit future import flow.
