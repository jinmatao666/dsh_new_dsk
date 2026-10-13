# Agent Note: bounded SkillHub archive capacity

Status: implemented

English | [中文](2026-10-13-skillhub-archive-capacity.zh.md)

## Problem

SkillHub packages containing many small reference files are rejected by a shared 128-entry import bound. Raising only the ZIP bound leaves a second rejection in directory validation, and personal-import error text obscures the source of a failed SkillHub installation.

## Decision

The desktop local ZIP, directory and file-list importers share a 4096-entry/file bound. ZIP counts include explicit directories. SkillHub uses the same importer and prefixes its validation errors with its source, replacing personal-import labels. The 16 MB compressed and expanded byte limits, depth restriction, path and link rejection, receipts and staged publication remain intact. Platform-server package validation remains separate.

## Alternatives considered

**Remove the count limit.** Small or empty entries can consume resources even below the byte limit, so imports retain a finite count bound.

**Raise only the ZIP limit.** The extracted directory still fails at its independent file-count check.

## Consequences

Reference-heavy skills can install without bypassing extraction safeguards. Native tests cover installation at 4096 entries, rejection at 4097, expansion beyond the byte limit and unsafe packages. A new desktop binary is required; this does not establish successful installation of every live SkillHub archive or change backend and expert containers.
