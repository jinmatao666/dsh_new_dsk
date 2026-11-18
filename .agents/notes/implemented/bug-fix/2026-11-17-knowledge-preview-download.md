# Agent Note: Knowledge preview downloads use native file saving

Status: implemented

English | [中文](2026-11-17-knowledge-preview-download.zh.md)

## Problem

The file preview revoked the download blob URL during the click handler. The browser can resolve that URL after the handler returns, and the desktop WebView does not reliably save files from anchor downloads.

## Decision

The main desktop window passes authorized file bytes and the original file name to the native downloads writer. The writer chooses the Downloads directory and creates a new name when the original already exists. A failed local save keeps the paid bytes for a retry in the same preview. The browser fallback keeps its blob URL alive after requesting the download.

## Consequences

The desktop result appears only after the file has been written. Downloads retain the original extension, including formats whose preview titles omit it.

## Alternatives considered

Keeping the browser link alive fixes the URL race in a browser. The native command also reports when the desktop write succeeds or fails.
