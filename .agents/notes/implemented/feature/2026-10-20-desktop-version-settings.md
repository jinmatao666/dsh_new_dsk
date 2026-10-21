# Agent Note: Desktop version settings and download progress

Status: implemented

English | [中文](2026-10-20-desktop-version-settings.zh.md)

## Problem

Account settings mixes identity management with native updates and embeds download progress in the account page. Navigating away removes progress, while automatic updates can begin outside settings.

## Decision

The client registers Version at order 35 before Account at order 40 and registers a separate shell progress overlay. One plugin-lifetime controller serially polls native status and shares its snapshot with both views. Entering downloading or installing opens a top-layer HTML dialog. Hiding a download changes presentation only; repeated polls do not reopen it, and Version offers explicit reopening. Installation cannot be dismissed. Bytes and percentages come from native status; unknown totals use indeterminate progress.

The interface retains the existing blue and white palette, with a compact version panel, accessible switch and explicit check button. Native download and installation confirmations, signatures and final busy veto remain unchanged. This presentation does not authorize installation.

## Alternatives considered

**Monitor inside Version:** closing settings would remove monitoring and could not show automatic-download progress elsewhere.

**Independent polling in both views:** separate state and actions can disagree or issue duplicate commands. One shared controller owns polling and plugin disposal.

## Consequences

Account remains identity-only. Closing Version does not interrupt monitoring or downloads. Browser-only compositions render no executable controls. In-flight and superseded responses cannot publish after disposal. Browser previews use simulated native status, not an actual installer.

## Testing

Owner-local tests cover preference persistence, native actions and failures, page unmount, dialog hide/reopen, unknown totals, installation dismissal denial and polling disposal. A Loader composition checks real client registrations, order and shared monitor identity. Browser review uses the real views for modal focus, Escape, narrow geometry and progress outside settings content. Installed-platform upgrade acceptance remains required.
