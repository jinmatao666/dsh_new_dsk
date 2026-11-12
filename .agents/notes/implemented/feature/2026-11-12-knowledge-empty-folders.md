# Agent Note: Persisted knowledge folders

Status: implemented

English | [中文](2026-11-12-knowledge-empty-folders.zh.md)

## Decision

OneAPI stores empty folder paths separately from RAGFlow documents. The desktop merges saved folders and uploaded document paths by name. Selecting a folder opens only that directory; breadcrumbs return to ancestors. Uploads and new folders use the current directory, so displayed contents and the upload destination agree. Creating a folder requires ownership of an uncategorized personal library. Names are validated at the HTTP endpoint and unique per library; deleting the library removes its folders.

Placeholder documents are rejected because they change file counts and may enter retrieval. Browser-local storage is rejected because directory organization belongs to the authorized library across devices.

This partially supersedes the hidden folder entries in [personal-only uploads](2026-11-06-desktop-knowledge-upload-personal-only.md), whose visibility rules remain active. The [package README](../../../../packages/wanwei/knowledge-base/README.md) owns menu behavior.

## Verification

Client tests cover directory selection, relative-path upload into the current directory, breadcrumb navigation, empty-folder persistence after remount, and duplicate names. Host tests cover authenticated routing and invalid parameters. Go tests cover saved reads, duplicate and invalid names, and foreign or public libraries.
