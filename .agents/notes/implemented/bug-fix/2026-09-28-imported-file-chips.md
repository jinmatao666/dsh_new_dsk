# Agent Note: Imported file chips

Status: implemented

English | [中文](2026-09-28-imported-file-chips.zh.md)

## Problem

Desktop imports replace the composer draft with path text. Quoted filenames can remain visible as literal mentions, and asynchronous completion can replace newly typed text or existing reference chips.

## Decision

The generic conversation action `appendReferences` appends structured references to the live editor. The product plugin owns filename labels, path mentions, native commands and drop listeners. File and folder references use the existing reference codec and chip renderer.

The desktop forwards window-level and main-WebView-level drag events to the trusted renderer. Tauri's `unstable` multi-WebView runtime creates the main view as a child and delivers its drag events through `WebviewEvent`, not `WindowEvent`.

The product drag invitation renders inside the positioned composer card, not across the window. Folder chips omit a display-only trailing slash, but retain it in the serialized reference; collision suffixes remain visible because they identify the actual copied destination.

## Alternatives considered

**Replace the full draft with mentions.** This loses structured references and depends on automatic token recognition for display.

**Put desktop imports into the official editor.** This couples product commands to official UI code. The editor accepts only generic reference data.

## Consequences

Imports preserve existing content and model path references. Input action implementers must provide the new callback. Browser file dragover permits drop delivery; native shell drag delivery still requires desktop verification.

## Verification

Composer and product tests cover repeated imports, quoted paths, folders, live drafts, locked sessions, native drop dispatch and submitted path serialization. No installed desktop drag-and-drop result is claimed by these tests.
