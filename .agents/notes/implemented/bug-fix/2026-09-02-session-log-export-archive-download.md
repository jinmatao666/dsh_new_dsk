# Agent Note: Fetch session archives before browser download

Status: implemented

English | [中文](2026-09-02-session-log-export-archive-download.zh.md)

## Problem

The Session log action sent a `HEAD` request to confirm that the export endpoint existed, then passed the endpoint URL to an HTML download anchor. A desktop WebView can accept that anchor gesture without creating a saved file, so the UI reported success without ever transferring the ZIP archive.

## Decision

`dsh-session-log-export` requests the export endpoint with `GET` and waits for the ZIP bytes. In a browser it creates a Blob URL and uses the normal browser download gesture. In the desktop WebView it sends the fetched bytes through the trusted Tauri bridge to `save_session_log_archive`, which writes a new file in the current user's Downloads folder. The native writer rejects unsafe names and never replaces an existing export; duplicate names receive a numeric suffix. The success dialog is published only after the browser gesture or native write succeeds.

## Alternatives considered

**Keep the `HEAD` validation followed by a URL anchor.** Rejected because it validates endpoint availability but cannot prove that the archive was fetched or that a desktop WebView persisted it.

**Use a Blob URL in every surface.** Rejected after desktop verification: the external-sidecar WebView accepts an anchor click without reliably persisting a file. The client still fetches the same archive bytes in both surfaces; only the final persistence operation is platform-specific.

## Consequences

Export waits for the complete ZIP response before success is shown, so a large archive can keep the button in its preparing state longer than the former header-only request. Browser users receive a Blob-backed download; desktop users receive a verified file in Downloads. A native write failure is shown as an export error instead of a false successful download.
