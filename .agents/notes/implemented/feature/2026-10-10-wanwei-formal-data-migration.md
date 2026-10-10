# Agent Note: Wanwei Buddy formal identity and historical data migration

Status: implemented

English | [中文](2026-10-10-wanwei-formal-data-migration.zh.md)

## Problem

Most users own the original desktop whose home is `~/.dsh`; a smaller population owns the separate new-generation installation. Restoring only a display name or copying one home leaves the other population's history inaccessible. Copying storage files without merging workspace records hides imported sessions.

## Decision

The desktop's visible name is 万维Buddy, executable is `wanwei-buddy`, and release identifier is `com.wanwei.harness`. Development uses `com.wanwei.harness.development` and is excluded from historical migration. Installer, shell and GitHub release names use the same product name. The workflow filename remains stable for existing dispatch callers.

The native migration module owns a one-time import before the release sidecar starts. It discovers the formal home, `com.wanwei.harness.preview/dsh-home`, and `~/.dsh`, with that precedence. It snapshots user settings, identity, sessions, storages, attachments, skills and compatible presets, preserves original directories, and prepares a complete staged home. Historical executable profile patches and credentials are not activated. Existing formal runtime configuration remains intact. Workspace registry version 2 merges by filesystem path, preserves separate paths even when IDs collide, and unions session membership. Absolute workspace paths remain unchanged.

Equal session files deduplicate. Byte-prefix continuations retain the longer file without merging events. Divergent logs and different encodings retain the preferred active variant, while all source variants remain recoverable in `migration-backups` and are listed in `.wanwei-formal-migration-v2.json`. Conflicting installed skills remain complete units instead of mixing scripts and secrets. This does not make divergent branches appear as two conversations. Unsupported session events and missing external files are not converted or reconstructed.

A completed staged home replaces the active home only after copying and registry validation. Existing formal data is moved into the recovery directory, not deleted. A pending-publication record resumes an interrupted publish. An incompatible registry or copy error stops startup instead of silently starting with missing history. Both historical applications must be closed before upgrading; snapshot copying is not a transaction with another application's live writes.

## Alternatives considered

**Display-name-only rename.** It retains the separate installer identity and does not converge installations or import original users' records.

**Overwrite one home with the other.** It loses unique records and configuration and mixes different skill versions. Staging, source snapshots and a registry-aware merge preserve recoverability.

**Splice divergent logs.** Different event sequences can contain incompatible tool and branch references. Retaining a preferred active log and all original variants avoids fabricating a conversation; automatic branch conversion is outside this import.

## Consequences

Most users upgrade directly from the original product, without needing the intermediate separate installation. Migration consumes extra disk space because originals and snapshots remain. The Rust tests cover each source alone, both sources, workspace merging and ID conflicts, append-only and divergent logs, rejected registries and interrupted publication. Windows/macOS/Linux installer upgrade and real-device history acceptance remain platform checks; they are not established by temporary-directory tests.
