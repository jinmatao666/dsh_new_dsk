# Agent Note: Separate skill downloads from distinct installations

Status: implemented

English | [中文](2026-10-10-skill-download-installation-counts.zh.md)

## Problem

Desktop popularity counts and administrator installation counts describe different quantities. Installation reporting without authentication is rejected by OneAPI, and silent failure hides missing counts.

## Decision

The desktop reports a successful platform installation or update with its Host-held login token. OneAPI increments the existing download total and retains one account-and-skill installation record in the same transaction. The administrator's installation column uses distinct accounts; desktop cards use the cumulative total. Uninstalling does not decrement either count. Invocation statistics and SkillHub counts are unchanged.

## Alternatives considered

**One shared counter:** user deduplication hides repeat desktop downloads, while cumulative counting overstates distinct installations in the administrator's list.

**Infer identities from historical totals:** historical downloads contain no account identities, so deduplicated backfill would fabricate data.

## Consequences

Distinct installations start from authenticated reports; existing download totals remain intact. Both OneAPI and the desktop require updates for the complete behavior. Reporting failure preserves the successful local installation and displays a synchronization error. No automatic download-report retry is performed, and failed deliveries are not replayed after restart.
