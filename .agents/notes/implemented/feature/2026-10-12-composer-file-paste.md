# Agent Note: Composer document-file paste

Status: implemented

English | [中文](2026-10-12-composer-file-paste.zh.md)

## Problem

The editor routes pasted file items into image intake, whereas desktop document drops already copy files into a selected workspace and append references. OS file-list clipboard formats can also produce no DOM paste data.

## Decision

The [product UI](../../../../packages/wanwei/product-ui/src/client/product.tsx) intercepts document files only inside its editable composer card, imports them through the existing file command and relays residual images/text to the editor. It does not change generic editor or image behavior. A paste gesture without DOM content invokes the [native file-list command](../../../../products/wanwei-desktop/src-tauri/src/clipboard_files.rs). Ctrl/Cmd+V schedules that fallback only if the ordinary paste has not handled a payload; empty native results add nothing. Timers and listeners leave on component disposal, and an immediate import lock prevents concurrent duplicate imports.

The native command is restricted to the main window and takes file sources only from an explicit OS file-list format, not renderer-provided source paths or arbitrary text. Local file URLs are decoded with the existing URL library. Existing workspace copying, numbered collision names, symlink rejection and file/byte bounds remain authoritative. Clipboard access uses maintained clipboard-rs without image decoding features; Rust dependencies remain in the desktop shell rather than in the generic DSH or model tools.

## Alternatives considered

**Send every clipboard file to image intake.** Office files and PDFs are not images; this rejects valid files already accepted by dropping.

**Treat text resembling a path as file access.** Ordinary conversation text and URLs are not consent to import local files. Only explicit clipboard file-list content is accepted.

**Replace generic editor paste behavior.** Document import belongs to the desktop product and uses its native workspace command. The product relay preserves the existing text/image editor route without teaching generic DSH about Tauri.

## Consequences

Frontend tests cover Office/PDF files, mixed paste, unrelated fields, native fallback, duplicate suppression, empty lists, failures and disposal. Rust path tests cover Unicode, escaped spaces, native absolute paths and rejection of relative/web paths. Native file imports require a rebuilt desktop shell. The native fallback does not supersede nonempty text/image DOM payloads; platform clipboard behavior needs installed Windows/macOS verification before release.
