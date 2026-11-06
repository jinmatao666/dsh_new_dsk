# Agent Note: Desktop knowledge upload is personal-only

Status: implemented

English | [中文](2026-11-06-desktop-knowledge-upload-personal-only.zh.md)

## Problem

The desktop Knowledge content toolbar showed the same upload menu for every selected library, so callers could open upload on 公共知识库 and 订阅知识库 even though those surfaces are not caller-writable. The personal upload menu also listed several unconnected sources that cluttered the entry.

## Decision

`libraryIsDesktopPersonal` is true only for uncategorized personal libraries (`kind === 'personal'` and `category_id` absent or 0)—the same rows that appear under 个人知识库. `libraryAllowsDesktopUpload` delegates to that predicate. The content toolbar renders the upload control only when that predicate holds and closes an open menu when the selection leaves personal. The personal menu keeps 本地文件, 网页链接 (see [desktop knowledge web-link import](2026-11-06-desktop-knowledge-web-link-import.md)), and 录音纪要 (see [desktop knowledge recording minutes](2026-11-06-desktop-knowledge-recording-minutes.md)). Entries for personal-library import, notes, Tencent docs, local folder, and empty folder stay hidden. File context-menu delete uses the same personal-group predicate (see [desktop knowledge file context delete-only](2026-11-06-desktop-knowledge-file-context-delete-only.md)).

## Alternatives considered

**Hide only the upload actions that call `api.upload`, keep the button for stubs.** Rejected; a visible upload control on read-only libraries implies callers can add content.

**Gate upload on `owned_by_viewer` for every kind.** Rejected; public and subscription sidebar groups must never show upload even for an owner browsing them from those rows—the product rule is group-scoped, and personal is already ownership-scoped by construction.

## Consequences

Selecting a public or subscribed library removes the upload button from the toolbar. Focused Client tests cover the personal menu trio and the hidden control on public and subscription selections.
