# Agent Note: SQLite token quota settlement

Status: implemented

English | [中文](2026-11-23-sqlite-token-quota.zh.md)

## Problem

SQLite rejects `GREATEST` in token quota updates. Legacy model settlement can deduct the account and record consumption while leaving the token's remaining and used quota unchanged. A later successful token write can also hide an earlier account error.

## Decision

Token debit and refund reuse the existing dialect-aware zero-floor SQL expression. Signed batch deltas retain the same semantics. `PostConsumeTokenQuota` returns an account error before changing token quota. [Model quota accounting](../../../../services/one-api/docs/model-quota.md) defines the verification procedure.

## Alternatives considered

**Compute remaining quota after reading the token.** Concurrent calls can overwrite one another; an atomic expression preserves the existing update behavior.

**Rebill historical failed token updates.** The account can already have paid. Historical balances need request-specific reconciliation, not automatic replay of account charges.

## Consequences

SQLite, MySQL and PostgreSQL share token update semantics. Legacy account and token writes remain separate operations; this fix does not promise transactional rollback across them. Regression coverage checks debit, refund, zero-floor batch deltas, account error propagation and agreement between relay logs and actual balances.
