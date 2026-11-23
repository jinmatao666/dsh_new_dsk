# Agent Note: Forum prices and answer reuse belong to the billing backend

Status: implemented

English | [中文](2026-11-23-forum-analysis-billing.zh.md)

## Problem

The forum needs separate administrator prices for popup questions and report generation. Reopening the page or changing the desktop model must not charge the same user again for an already answered question. Charging both the business operation and its model tokens produces a second debit.

## Decision

Two fixed configured charge points default to one point each. The backend quotes their revisions before execution and reserves through the unified billing transaction used by experts. A durable question key includes account ownership, source type and ID, whitespace-normalized question and action. Completed answers remain authoritative across history, model and price changes; active attempts exclude another execution. Failed and expired attempts release their reservation before retry.

Saving the answer and settling the task commit together. The Host retains the attempt capability and retries an unconfirmed result without regenerating or refunding a potentially completed answer. Abandoned reservations expire through the existing unified worker. A reserved attempt authorizes only one platform text request for its exact account, session and selected model. An atomic claim rejects another HTTP request; internal channel retries reuse the original claim. Model usage is recorded at zero additional credit cost. The disposable session uses the article title to suppress auxiliary title inference.

The [desktop model selection decision](2026-11-23-forum-desktop-model-analysis.md) continues to own iframe validation, credential isolation and logged model work. [Knowledge settlement](../architecture/2026-11-18-knowledge-unified-credit-settlement.md) independently owns reference-dependent library prices; neither decision is superseded.

The iframe exposes only question submission and cancellation; the Host owns price lookup and the HTTP analysis stream. Settlement callers await one shared drain instead of treating another active drain as completed work. Cached-answer lookup rechecks the active account before returning its answer.

## Alternatives considered

**Deduplicate only in browser memory or local storage.** Refreshes, another installation and concurrent requests can bypass that state, and it cannot atomically own the account debit.

**Keep token charges after reserving the configured fee.** This violates the selected fixed price and can reject a user who had exactly enough credit for the operation.

**Trust a caller-provided session ID as a billing exemption.** Attribution is not proof of reservation. The backend requires the account-owned running attempt, unexpired task, selected model and unused model-call claim.

## Consequences

The desktop, management backend and forum frontend ship together. Successful answers are retained without a cache timeout; edited source content still shares the original source/question identity. If the Host cannot persist a completed answer, it reports unconfirmed settlement and retries that same result; a Host crash can lose the unsaved answer and the reservation eventually refunds. Generating a report returns analysis text in the drawer. [Portal documentation](../../../../packages/wanwei/portals/README.md) owns the operational behavior.

## Verification

Focused coverage checks versioned price updates, separate action prices, account isolation, persistent answer reuse, duplicate attempts, model-claim replay rejection, refunds, insufficient credit and zero additional model debit. Host tests exercise result-confirmation retries and Client tests exercise immediate submission, live text updates and sanitized Markdown. The backend infers report-writing requests from the question; no report button or fee confirmation is exposed. A recorded session pins the tool-free model input and title event.
