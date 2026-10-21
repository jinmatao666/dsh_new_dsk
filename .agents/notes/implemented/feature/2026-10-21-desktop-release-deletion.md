# Agent Note: Desktop release deletion retains version history

Status: implemented

English | [中文](2026-10-21-desktop-release-deletion.zh.md)

## Problem

Administrators need to remove unused desktop update uploads without breaking the current update channel or removing its downgrade protection.

## Decision

Root-authenticated deletion accepts only unpublished records. The [controller](../../../../services/one-api/controller/desktop_update.go) locks the upload and platform channel in the same order as publication. Deleting the withdrawn current record clears its channel reference but preserves the high-water version. The database removal commits before artifact cleanup; cleanup failure reports a warning and leaves a logged orphan for operator cleanup rather than restoring a publishable record.

The administrator confirms permanent deletion. List operations retain the current page and clamp an empty final page. Release notes use a viewport-constrained, centered dialog with scrollable text.

Upload and list filters reuse the administrator's custom dropdown component instead of native OS menus. Disabled architecture options remain unavailable, and keyboard navigation, Escape dismissal and visible focus are preserved. Styling is scoped to release controls so other administrator pages retain their appearance.

Publication below the retained historical version requires separate consent bound to the candidate version. The administrator sees a confirmation prompt, not an error toast. The history value remains the maximum version; client update availability compares the selected record's actual version against the requesting client's version. Publishing an older record therefore does not advertise a downgrade to newer clients, and signature verification remains mandatory.

## Alternatives considered

**Delete active releases directly.** This can invalidate an update while clients are discovering it. Explicit withdrawal keeps the availability change separate from permanent cleanup.

**Delete the platform channel with the record.** This loses the historical comparison needed for lower-version confirmation. The warning history survives removal of its upload.

## Consequences

Deletion removes the selected record and attempts to remove only its ID-scoped artifact directory; it does not uninstall client software. Filesystem and database changes are not atomic. Integration tests cover authorization, active-release rejection, draft and withdrawn deletion, missing IDs, file cleanup and retained downgrade protection. Frontend tests cover confirmation, errors and pagination; production-page checks cover dialog bounds at 1440, 820 and 390 pixels. Real production deletion remains an operator acceptance step.
