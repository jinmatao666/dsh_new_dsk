# Agent Note: Installer preserves desktop data

Status: implemented

English | [中文](2026-10-14-installer-preserves-desktop-data.zh.md)

## Problem

Deleting the formal application data directory removes recent skills and Sessions together with the migration marker. The next launch can import surviving legacy data, making old skills appear while recent installations are absent. Startup migration alone cannot protect data deleted before startup.

## Decision

The Windows product pins the Tauri CLI 2.11.4 NSIS template with two product changes: remove the uninstall data-deletion checkbox and remove the corresponding APPDATA/LOCALAPPDATA deletion block. Program-file cleanup, update handling and process hooks retain the upstream extension points. Before installation or removal, the product hook stops executables located inside the selected installation directory, including orphaned Node and Feishu CLI processes, and waits for exit. Cleanup failure stops installation with a retry prompt. The hook uses native Windows PowerShell so 64-bit executable paths remain visible from the 32-bit installer; processes outside the installation directory and the installer itself are excluded. The release identifier stays `com.wanwei.harness`.

The installer-data check rejects data-deletion controls, user-data removal commands in the template or hooks, the default template and identity changes. Installer CI and both runner packaging commands execute it. A native migration regression verifies that skills, Sessions, settings and the marker added or retained after migration survive repeated startup migration calls. The existing [formal data migration](../feature/2026-10-10-wanwei-formal-data-migration.md) remains responsible for historical imports.

## Alternatives considered

**Ask users not to select data deletion.** Rejected because ordinary reinstalls must not depend on remembering a destructive option.

**Import legacy data on every launch.** Rejected because legacy sources do not contain recent installations and can reintroduce removed skills.

## Consequences

Uninstall leaves persistent user data on disk. Explicit cleanup is separate from installer removal. The pinned template requires review when the Tauri CLI changes; its upstream source and license are recorded beside the template. This protection starts with newly built installers and does not modify an already installed older uninstaller or recover already deleted files. Native installer acceptance remains a release check; no production uninstall is exercised by tests.
