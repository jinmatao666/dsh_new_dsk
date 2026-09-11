# Agent Note: Desktop Workspace External File Drop

Status: implemented

English | [中文](2026-09-11-desktop-workspace-external-file-drop.zh.md)

## Problem

Desktop users can open an existing Workspace but cannot put a file from the operating system into it without leaving the application. Chat image attachments do not solve that problem: they are durable conversation input rather than files the current Workspace and its tools can use.

## Decision

The desktop Workspace sidebar accepts operating-system file drops when the current Session belongs to a registered Workspace. The browser reads the dropped file bytes and invokes the Tauri-only `import_workspace_files` command with that Workspace path. The native shell canonicalizes the root, accepts only base filenames, and creates new files there. It accepts at most 64 files, 64 MiB per file, and 256 MiB per drop. Existing files remain unchanged; a conflicting filename receives a numeric suffix.

The user-facing import path receives file bytes only for an active user drop and writes immediate children of the current registered Workspace. It does not contact One API or persist a chat attachment. Browser deployments have no bridge and report that direct import is unavailable. Directory drops are not represented as file objects and remain unsupported.

The Workspace association rule matches [Workspace UI Complete Product Flow](2026-07-25-workspace-ui-product-flow.md): the selected Session must appear in the Workspace index and have the same Workspace cwd. Ungrouped Sessions cannot receive a drop because there is no registered destination.

## Alternatives considered

**Send dropped files to the server.** The Workspace is local to the desktop host, while uploading to One API would create remote retention and authorization behavior unrelated to local file import.

**Treat every drop as a chat attachment.** A conversation image reference does not place an ordinary file in the Workspace where tools expect it, and it would exclude non-image files.

**Pass a source path to a native copy command.** Browser drag data does not provide a portable source path, while selected bytes work for every admitted file type and make the transferred content explicit.

## Verification

The Workspace browser test exercises a file drop into a selected Workspace and the no-Workspace rejection. Native tests pin collision suffixes and reject path traversal.

## Consequences

Desktop file drops work for ordinary documents and images without changing the One API service or image-attachment protocol. Large batches and directory trees still require an explicit future import flow.
