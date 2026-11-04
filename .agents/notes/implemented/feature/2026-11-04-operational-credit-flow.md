# Agent Note: Operational credits across account grants and model tasks

Status: implemented

English | [中文](2026-11-04-operational-credit-flow.zh.md)

## Problem

Registration settings did not grant their configured credits, administrator grants lacked an atomic actor receipt, and provider retries could prolong an exhausted task. A reservation cap combined with clearing the upstream output limit allowed generation beyond the reserved output budget.

## Decision

Operational registration rules own the initial gift when explicitly configured, including when disabled. Creating the user and its registration ledger entry share a transaction; the legacy trial gift does not stack with this rule. Administrator grants commit an immutable actor, recipient, amount, remark, expiry and balance receipt with the grant itself.

Configured model calls reserve the full permitted output at the request's price snapshot, and retain that limit on the upstream request. Omitted limits receive a bounded value. This protects funds before generation instead of guessing authoritative token usage from streamed text. Providers must honor the output limit and return accurate usage; live provider acceptance is required for those contracts.

Quota errors are terminal even under an always-retry policy. Managed-model tool dispatch verifies live unexpired credits and fails closed on unavailable account checks. Local custom providers and enterprise-account billing remain outside this personal-credit guard. The conversation renders a red quota notice rather than opening a modal.

Available usage on an interrupted response is settled; requests with no returned usage release their reservation. Refund cleanup cannot repeat the same local reservation. Consumption receipts retain reserved, charged and refunded quota, and fully refunded attempts have zero net consumption in the personal history. Origin-ledger refunds preserve expiry rather than creating permanent credits.

## Alternatives considered

Estimating charge from stream character counts was rejected because provider tokenization, cache and reasoning usage are not reconstructable from text. Charging a fixed task fee was deferred for skills and independently deployed experts; independent RAGFlow questions are also deferred.

## Consequences

Backend and desktop must be updated together. Token-level cancellation against unreported usage is not promised: the financial boundary is full reservation plus an enforced output budget, followed by authoritative settlement. Account switches, unavailable billing services and exhausted balances prevent new tool side effects. Production service compatibility and real-account acceptance follow local checks.
