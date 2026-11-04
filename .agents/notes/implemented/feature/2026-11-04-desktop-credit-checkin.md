# Agent Note: Desktop credit page and explicit check-in

Status: implemented

English | [中文](2026-11-04-desktop-credit-checkin.zh.md)

## Problem

A login reward configuration without a discoverable desktop entry cannot explain when credits arrive. An existing first-request activity must not also grant the recurring reward after users switch to explicit check-in.

## Decision

The operational edition uses its existing login reward settings as the manual check-in policy. The stored configuration key stays unchanged; the administrator sees Sign-in reward. Eligibility follows Beijing calendar dates and the last successful claim, with no catch-up grants. Recurring daily login and first-request activity triggers are skipped; one-time campaigns remain separate.

The sidebar shortcut opens Credits and usage above Account. It appears only while claiming is available. The page uses an existing modal for failures and an existing toast for success. A generic settings shortcut slot and section-opening event keep private product behavior outside the generic shell.

An atomic conditional claim marker, quota-ledger insert and immutable receipt share one database transaction. Concurrent requests cannot both commit a reward. The Host retains credentials and exposes only allowlisted credit operations. History merges personal quota grants and consume logs; unavailable historical balance snapshots remain blank rather than being reconstructed.

## Alternatives considered

Automatic login or first-request grants were rejected because the user explicitly chose manual check-in. A new wallet was rejected because the existing timed-quota ledger already participates in billing.

## Consequences

The updated backend must be deployed with the desktop client. Database migration adds claim-state and receipt tables. Registration rewards, paid packages and independent expert or skill task charges remain outside this change. The status read refreshes when the window gains focus and once a minute; the server rechecks eligibility on every claim.
