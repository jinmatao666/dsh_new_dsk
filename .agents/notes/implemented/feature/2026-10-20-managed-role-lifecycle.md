# Agent Note: Managed role creation and deletion

Status: implemented

English | [中文](2026-10-20-managed-role-lifecycle.zh.md)

## Problem

Manual role codes expose authorization details and collide with existing primary keys. The admin interface lacks safe deletion and its creation buttons do not match surrounding dialogs.

## Decision

Allocate member and administrator codes within existing authorization bands, skipping legacy user references. The unique constraints arbitrate competing inserts and duplicate names become an actionable error. Super-administrator creation is excluded; administrator creation and deletion require the built-in super-administrator. Delete only unused non-built-in roles, using a conditional database delete that checks user references in the same statement. Keep model configuration intact.

## Alternatives considered

A separate role identifier and permission category would remove numeric capacity limits but requires a broader authorization migration. This change preserves existing comparisons and reports band exhaustion instead of crossing privilege boundaries. Deleting assigned roles or silently reassigning users would change account permissions and is rejected.

## Consequences

Members have eight custom codes and administrators ninety under the current scheme. Deletion requires prior reassignment, including soft-deleted accounts. UI changes are scoped to role dialogs and preserve the blue-white admin palette. Successful deletion invalidates the corresponding cached entry. This does not add database foreign keys or redesign concurrent user-role assignment.

## Testing

Real Gin handlers and an isolated database cover allocation, legacy references, duplicate names, privilege escalation attempts, built-in and assigned-role protection, successful deletion and capacity exhaustion. React tests cover the real modal, type selection, pending submissions, inline errors, confirmation and cache updates.
