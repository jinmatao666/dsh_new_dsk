# Agent Note: Skill and expert usage events

Status: implemented

English | [中文](2026-09-29-usage-event-ledger.zh.md)

## Problem

Administrators need per-person skill and expert usage counts without treating an opened expert tab or an unsubmitted skill draft as use.

## Decision

The product Host observes `user/message` entries resolved by the official skill injector and each `tool/call` named `skill`, then reports separate `user_explicit` and `model_auto` events with stable IDs. An independent expert website reports after `worker.submit`; its provider credential identifies the expert and its redeemed ticket identifies the user. OneAPI stores events in an automatically migrated ledger and serves totals, top ten, department grouping and day buckets to four administration tabs. Department columns are nullable until organization attribution is available.

## Alternatives considered

**One count per conversation turn:** rejected because a model can call the same skill repeatedly in one turn.

**Counting expert tab opens:** rejected because viewing a profile does not start expert work.

## Consequences

Only an identical event ID is deduplicated. The desktop binds each pending skill event to the token active at capture time; it retries while running but does not persist an offline outbox across restart. Expert task reporting retries three times without blocking the accepted task.

## Testing

Host extraction tests cover repeated calls, retry IDs and plugin-injected messages. Each expert website tests the provider-authenticated report payload and runs its task and identity suites. OneAPI controller tests cover authorization, identity, deduplication and grouped queries; the administration frontend is production-built.
