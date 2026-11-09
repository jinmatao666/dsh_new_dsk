# Agent Note: Edition credit policy

Status: implemented

English | [中文](2026-11-09-edition-credit-policy.zh.md)

## Problem

Government installations need model access without platform credits. Network isolation does not determine whether accounting applies.

## Decision

Deployment settings carry independent switches for credit UI, model multipliers and accounting. Government defaults disable all three; operations defaults retain existing behavior. Administrators may override each switch. The desktop consumes the same resolved policy as relay billing. Requests snapshot accounting policy before reservation so a later mode change cannot charge an unreserved request. Disabled accounting bypasses exhausted-token checks but preserves disabled-token and expiry checks. Usage logs remain with zero quota.

## Alternatives considered

**Bind accounting to intranet mode.** Government services may access public networks, and private deployments may still require accounting. Edition and explicit switches express those independent choices.

## Consequences

Changing network mode does not change credit rules. Existing balances, prices and historical receipts are retained. Check-in, registration rewards and monthly grants do not issue credits while accounting is disabled.
