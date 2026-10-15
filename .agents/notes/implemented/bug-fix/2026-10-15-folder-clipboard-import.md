# Agent Note: Folder clipboard import

Status: implemented

English | [中文](2026-10-15-folder-clipboard-import.zh.md)

## Problem

Clipboard directories can appear as browser File objects. Reading their bytes can reject with NotFoundError before the native directory importer runs.

## Decision

Document pastes query the native clipboard file list first and use the bounded workspace path importer for files and directories. Only an empty native list permits browser-byte import. Images and text retain their existing handling.

## Alternatives considered

Directory detection through browser entries is insufficient when the WebView exposes no directory entry. Retrying every native error through browser bytes could repeat a partially completed import, so native failures remain visible without that retry. Picker and drag behavior are unchanged.

## Consequences

Folder pastes avoid browser byte reads and retain native size limits and collision handling. Each document paste reads the native clipboard before the optional browser-byte import.

## Testing

Client regressions cover an unreadable directory File, one import per paste gesture, empty-native-list byte import, mixed image/text pastes, and visible failures. OS clipboard behavior in installed Windows and macOS builds remains a release acceptance check.
