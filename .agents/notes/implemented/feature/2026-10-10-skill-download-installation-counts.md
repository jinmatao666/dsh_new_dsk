# Agent Note: Separate skill downloads from distinct installations

Status: implemented

English | [中文](2026-10-10-skill-download-installation-counts.zh.md)

## Problem

Desktop popularity counts and administrator installation counts describe different quantities. Installation reporting without authentication is rejected by OneAPI, and silent failure hides missing counts.

## Decision

The desktop confirms complete package receipt with its Host-held login token and a fresh download event ID, then confirms successful native installation using that ID. OneAPI atomically inserts the deduplicated event, increments the existing total and updates the account-and-skill summary. Installation confirmation changes the summary's ever-installed flag and retains the existing distinct-installation row without increasing downloads. Uninstalling does not decrement either count. Invocation statistics and SkillHub counts are unchanged.

`skill_user_stats` has a composite `(user_id, skill_id)` primary key, cumulative downloads, an ever-installed boolean, first/last download and installation times, and the last installed version. `skill_download_events` has a composite `(user_id, event_id)` primary key, stable skill ID, downloaded version, download time and optional installation-confirmation time. Duplicate reports cannot increment counts; a reused event cannot refer to another skill or version. New skills and users need no schema changes. Soft deletion retains history. No per-user administration page is added.

Startup backfills known first installations from `skill_installations` without overwriting existing summaries or inventing per-user historical downloads. Existing aggregate totals remain intact. Older clients use the legacy combined install report and contribute one download and installation confirmation per received report; they cannot supply retry deduplication IDs or downloaded versions.

## Alternatives considered

**One shared counter:** user deduplication hides repeat desktop downloads, while cumulative counting overstates distinct installations in the administrator's list.

**Infer identities from historical totals:** historical downloads contain no account identities, so deduplicated backfill would fabricate data.

## Consequences

Both OneAPI and the desktop require updates for separate receipt and installation confirmation. Download-confirmation failure stops local installation; installation-report failure preserves the successful local installation and displays a synchronization error. Reports are not automatically retried or replayed after restart, so statistics describe server-accepted confirmations rather than every filesystem operation. Transactions roll back events and counters together. Model tests cover deduplication, users, versions, rollback and restart-safe backfill; the Loader-composed Host test covers the authenticated two-phase request sequence. Installed-desktop acceptance and the production database dialect remain deployment checks.
