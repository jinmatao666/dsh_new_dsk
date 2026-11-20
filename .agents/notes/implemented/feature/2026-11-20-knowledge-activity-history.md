# Agent Note: Knowledge activity history

Status: implemented

English | [中文](2026-11-20-knowledge-activity-history.zh.md)

## Problem

Library and application rows describe current state. Renaming a library or resubmitting an application prevents those rows from representing stable history.

## Decision

OneAPI appends activity rows with library names, actor identifiers, timestamps and outcomes. Creation, library deletion, category deletion and review events commit with their business transaction. File deletion snapshots the remote filename before removal and commits its success event with local metadata cleanup. Failed remote deletions do not create success records. Successful file transfers log source and destination names after the remote operation. A log failure returns an explicit partial-success error. Root can read all events; other administrators can read their own operations and events for libraries they own.

## Alternatives considered

Reconstructing events from applications loses outcomes when applications are replaced or withdrawn. Dedicated activity rows survive library deletion. Operations without recorded events remain unavailable.

## Consequences

Deployment creates the table automatically. All activity types share one paginated timeline. Server-side search filters library names, file names and related users before counting and pagination, within the caller’s authorized records. The operation cell pairs each action with its operator or reviewer; creator and applicant roles remain explicit. Remote file operations and SQL logging cannot share a transaction. Names resolve from current user identities, with user IDs as fallback.
