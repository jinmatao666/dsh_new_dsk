# Agent Note: GIS expert terminal-task deletion

Status: implemented

English | [中文](2026-10-30-gis-expert-task-delete.zh.md)

## Problem

`coordinate-transform`, `gis-format-converter`, and `cad-redline-extractor` keep failed and completed runs in each user's task history until retention expires. Operators and users need to remove a bad or obsolete record immediately without waiting for `EXPERT_RETENTION_DAYS` or editing SQLite by hand.

## Decision

Each of the three experts exposes `POST /api/tasks/<id>/delete` for the owning session. Only terminal states (`succeeded`, `failed`, `cancelled`) delete; queued or running tasks must be cancelled first. Deletion removes the SQLite row and the task directory under that expert's data root. The history list shows a delete control on terminal rows; the task detail page offers the same action. Ownership stays session-scoped: another user's cookie receives 404.

## Alternatives considered

**Retention-only cleanup** leaves failed runs visible for up to thirty days and requires host access for earlier removal.

**Deleting while a worker still holds the process** risks racing a finishing conversion; the handler refuses when the task remains in `worker._active` after cancel, matching the image experts.

**A shared library across the three expert trees** would break the independence rule that each expert directory ships alone.

## Consequences

Failed and completed history can be cleared from the workbench. Active conversions still need cancel first. Deployments keep existing Compose project names and data volumes; no schema migration is required.

## Testing

Store tests cover active-state rejection, foreign-user refusal, and directory removal. Server tests cover HTTP ownership and the cancel-first error. Frontend static checks assert the delete control and `/delete` call site in each expert.
