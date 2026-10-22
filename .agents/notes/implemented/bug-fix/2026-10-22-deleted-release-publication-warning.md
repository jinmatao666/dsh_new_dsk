# Agent Note: Deleted release versions do not trigger publication warnings

Status: implemented

English | [中文](2026-10-22-deleted-release-publication-warning.zh.md)

## Problem

Deleting the upload for a platform's historical maximum leaves its version in the channel. Comparing publication against that value alone prompts administrators about a release they have already removed.

## Decision

Publication checks whether an upload with the channel's historical version still exists on the same platform before requiring lower-version confirmation. A missing upload is excluded even when the channel predates this check; no database migration or repeat deletion is needed. This supersedes the deleted-upload warning behavior in the [release deletion decision](../feature/2026-10-21-desktop-release-deletion.md), not withdrawal, signing or client version comparison.

## Alternatives considered

**Clear history only during deletion.** Previously deleted uploads would still trigger warnings until manually repaired.

**Suppress warnings only in the browser.** The publication endpoint would still reject the request with a confirmation response.

## Consequences

Retained historical uploads still require explicit consent for older publication. Deleting an upload is not permission to downgrade installed clients: equal and newer clients continue receiving no update. Integration tests cover delete-then-publish, pre-existing orphaned channel history, exact platform isolation and client version comparison.
