# Agent Note: User prompt audit pagination

Status: implemented

English | [中文](2026-09-15-user-prompt-audit-pagination.zh.md)

## Problem

The model-log page loaded one fixed batch of user prompt audits, so administrators could not inspect older records. Filtering framework-generated messages after applying the database offset could also repeat or skip records between pages.

## Decision

The administrator endpoint applies the shared framework-message exclusions before counting and pagination, then returns the filtered total with the requested page. The model-log page requests 50 records per page and renders numbered, previous, and next navigation from that total.

The write path and list path share the same excluded-prefix list so framework messages remain absent from both new records and historical query results. The list loader discards responses superseded by a newer page request.

## Alternatives considered

**Paginate the first response in the browser.** Client-side pagination cannot expose records that the server never returned.

**Expose only previous and next controls.** A has-more response supports sequential browsing but does not show the number of matching records or permit direct page selection.

## Consequences

Administrators can browse the complete filtered audit history in stable 50-row pages. Each page request also performs a filtered count query so the interface can show the total and page numbers.
