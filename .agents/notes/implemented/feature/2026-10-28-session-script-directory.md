# Agent Note: Session script directory in desktop workspaces

Status: implemented

English | [中文](2026-10-28-session-script-directory.zh.md)

## Problem

Desktop agents create helper scripts and conversion files while producing documents. Keeping these files beside final documents makes the selected workspace hard to navigate, especially across repeated conversations.

## Decision

The OneAPI desktop Host registers a session-scoped system prompt section for each agent with an absolute workspace. It directs generated helper scripts and intermediate processing files to `.dsh-work/<session-id>/scripts`, while final deliverables default to the workspace root. The directory is created on first use by the agent. Existing inputs stay in place, and each agent receives its own path. The prompt section is disposed with its agent or plugin.

## Alternatives considered

**Move files after each turn** risks breaking script invocations, references and user-authored code, and cannot reliably distinguish a requested script from a helper.

**Rewrite every shell and filesystem operation** requires parsing multiple command languages and would change user-intended paths. The scoped guidance leaves explicit user output locations authoritative.

## Consequences

New desktop sessions have a predictable helper-file location without creating empty directories. Existing files are not migrated. The instruction is model guidance, not a filesystem restriction; writes can still land elsewhere if the agent disregards it. Final-file declaration continues to exclude helpers unless requested.

## Testing

Loader composition creates a real agent with a selected workspace, verifies its scoped directory and final-file instruction, and checks removal after plugin disposal.
