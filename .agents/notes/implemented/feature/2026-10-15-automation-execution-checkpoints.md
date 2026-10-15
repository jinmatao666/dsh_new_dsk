# Agent Note: Automation execution checkpoints

Status: implemented

English | [中文](2026-10-15-automation-execution-checkpoints.zh.md)

## Problem

An idle model can leave a task unfinished, and a command's successful exit does not prove usable data or a valid artifact. Searching outside an empty selected directory can consume the execution window and mix unrelated projects. Progress must remain inspectable after interruption.

## Decision

The [automation runtime](../../../../packages/wanwei/automations/src/runtime.ts) attaches each new execution to its selected Workspace, retains manual stop and defaults to a one-hour deadline. It leaves existing archive membership unchanged. The [local execution decision](2026-10-12-local-automation-execution.md) remains active for account ownership, scheduling and locked storage; this note supersedes only hidden execution Sessions and completed-turn-only success.

The [run protocol](../../../../packages/wanwei/automations/src/run-protocol.ts) records model-reported prerequisites, progress, missing conditions and completion through a Session-scoped tool. An empty directory does not force a failure for a task that needs no input files. Instructions limit task scope, require actual returned paths and preserve process work for manual continuation. Full access is not reduced to a filesystem sandbox.

A completed checkpoint is required for success. File tasks retain their output requirement and must supply final paths. Host verification rejects missing, empty, unreadable or out-of-Workspace files and parses DOCX, PDF and XLSX through the shipped document helper. The ledger and ordinary tool-result log preserve the latest checkpoint. Missing prerequisites end as waiting, absent completion ends as incomplete, and timeout remains a distinct failed run with a continuation hint.

## Alternatives considered

**Stop every empty-directory task:** text generation, connectivity checks and empty-state audits can legitimately succeed without source files. Prerequisite findings depend on the task rather than a directory-only rule.

**Only extend the deadline:** a longer window permits useful retries but does not distinguish progress from aimless searching or verify deliverables.

**Treat the final sentence as proof:** prose cannot independently establish a file's existence or readability. Explicit reports permit deterministic checks without guessing intent from keywords.

## Consequences

Reporting adds model calls and requires instruction following. The Host verifies report transitions and files, not the truth of arbitrary prerequisite summaries or semantic correctness. Unsupported file formats receive basic readability checks only. Manual continuation retains the original Session and artifacts without retroactively changing the original run status. Scope and process-file rules remain model instructions, not security restrictions. Loader/Agent integration tests cover completed, waiting, incomplete and timeout records; parser tests exercise valid and corrupt DOCX files. Live-model acceptance remains a deployment check.
