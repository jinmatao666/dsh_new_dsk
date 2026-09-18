# Agent Note: User prompt audit pagination

Status: implemented

English | [中文](2026-09-15-user-prompt-audit-pagination.zh.md)

## Problem

The model-log page loaded one fixed batch of user prompt audits, so administrators could not inspect older records. Filtering framework-generated messages after applying the database offset could also repeat or skip records between pages. Recording every upstream model request as a separate user question duplicated one desktop turn across tool-loop iterations, and reading the legacy `users.username` column exposed account-center placeholders instead of the user's login name.

## Decision

The administrator endpoint applies the shared framework-message exclusions before counting and pagination, then returns the filtered total with the requested page. The model-log page requests 50 records per page and renders numbered, previous, and next navigation from that total.

The write path and list path share the same excluded-prefix list so framework messages remain absent from both new records and historical query results. The list loader discards responses superseded by a newer page request.

The desktop session id and ordinal of the latest accepted user message identify one user turn. Every upstream request in that turn reuses its audit row, and successful or failed completion adds quota, token, and elapsed-time values to the turn totals. A later turn with identical text has a different ordinal and remains a separate record. Requests without desktop session identity retain request-level records because the server cannot identify their turn safely.

Audit writes and reads resolve the account-center username through the local-user product mapping. The stored legacy username remains a fallback when the account center is unavailable, while list-time overlay gives historical placeholder records the current authoritative login name without rewriting audit history.

## Alternatives considered

**Paginate the first response in the browser.** Client-side pagination cannot expose records that the server never returned.

**Expose only previous and next controls.** A has-more response supports sequential browsing but does not show the number of matching records or permit direct page selection.

**Deduplicate by session and question text.** Users can intentionally ask the same text more than once in one conversation, so text identity cannot define a turn.

## Consequences

Administrators can browse the complete filtered audit history in stable 50-row pages. Each page request also performs a filtered count query so the interface can show the total and page numbers. A desktop turn appears once with aggregate usage and the account-center login name; request-level detail remains available in the ordinary model-call log.
