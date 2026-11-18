# Agent Note: Knowledge subscription credits use unified billing tasks

Status: implemented

English | [中文](2026-11-18-knowledge-unified-credit-settlement.zh.md)

## Problem

Subscription-library receipts directly debit the ledger and issue maintainer shares. Independent settlement bypasses unified task states and requires separate handling for failed operations and interrupted question responses.

## Decision

The [subscription policy decision](../feature/2026-11-12-operations-knowledge-credits.md) retains edition exemptions, owner pricing, citation charging and preview access. This decision owns the shared settlement implementation.

Trusted Go knowledge handlers resolve maintainer prices and reserve through the same transaction implementation that owns the unified billing API. File operations reserve before contacting RAGFlow. Questions reserve one reference before completion, persist the complete answer, and settle each distinct referenced file atomically. No references release the initial reservation. Additional references reserve their prices inside settlement, and insufficient credit retains the saved answer for recovery.

The database retains task capabilities and price snapshots. The minute worker retries saved-answer settlement using the original task. Unified expiry releases reservations after thirty minutes. Maintainer shares use the issuance transaction shared with administrator grants, including its audit receipt. Consumption tasks and issuance commit with knowledge receipts in one transaction.

## Alternatives considered

**Calling the public API with a client-provided amount.** The current HTTP API requires configured charge points and rejects arbitrary amounts. Keeping maintainer price resolution inside the trusted backend preserves that restriction and allows consumption and issuance to commit together.

**Reserving every library file before a question.** Actual references are available after completion. Reserving the whole library would require credit for unrelated files and change the agreed per-reference policy.

## Consequences

Question completion can require additional credit after generation. The answer stays unavailable until settlement succeeds, and recovery does not regenerate it or replace an expired task. Each file price follows the unified limit of one thousand credits. Existing receipts remain valid and do not duplicate modern task consumption in desktop history.
