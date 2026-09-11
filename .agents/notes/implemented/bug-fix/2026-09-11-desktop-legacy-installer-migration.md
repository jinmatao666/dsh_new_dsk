# Agent Note: Desktop legacy installer migration

Status: implemented

English | [中文](2026-09-11-desktop-legacy-installer-migration.zh.md)

## Problem

Changing the desktop product name from ZJUGIS Harness to 万维Buddy changes Tauri's Windows installation directory, uninstall registry key, and shortcut name. Windows therefore keeps the old release while installing the renamed release separately.

## Decision

The NSIS post-install hook locates a ZJUGIS Harness installation from its per-user uninstall record, falling back to its previous default directory. After the 万维Buddy release is installed, it silently runs the legacy uninstaller unless the new release intentionally uses that same directory.

The migration preserves user data. The legacy uninstaller removes only its own installation and shortcuts when run silently; it does not select its optional app-data deletion control. The stable bundle identifier remains `com.wanwei.harness`, so the new release continues to use the same application data.

## Alternatives considered

**Keep the legacy release and remove only its desktop shortcut.** The old installation would remain registered in Windows and could be launched from Start or Apps, leaving two product identities.

**Restore the old product name.** This would prevent duplicate installation but would expose ZJUGIS Harness in the new installer, shortcut, and Windows application list.

**Delete the old directory directly.** The legacy uninstaller is the owner of its files and registry entries; invoking it avoids guessing which files or shortcuts it created.

## Consequences

The first 万维Buddy installer built with this migration removes the old ZJUGIS Harness release after the new release is successfully installed. Subsequent upgrades use 万维Buddy's normal upgrade path. A legacy installation that cannot be found or uninstalled leaves the new installation usable and can still be removed through Windows Apps.
