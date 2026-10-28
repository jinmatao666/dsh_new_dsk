# Agent Note: Shared skill and expert catalog ordering

Status: implemented

English | [中文](2026-10-27-catalog-ordering.zh.md)

## Problem

Administrator lists and desktop catalogs use different ordering rules. Administrators also need to record which skills and experts require internet access.

## Decision

Skills, independent expert websites and both category tables store nullable integer `sort_order`. Explicit numbers sort descending before empty values; creation time descending breaks ties, followed by the primary key. Dragging or moving an item normalizes the complete active server list to descending ranks inside a transaction. Clients send source and target identifiers rather than ranks computed from a filtered page. The desktop skill catalog defaults to server order while retaining optional popularity and update-time views. Expert category positions travel with expert metadata independently of card order.

Administrator skill, expert and category rows expose a single four-direction drag handle at the far right. Only this handle starts a drag; the upper or lower half of a target row selects insertion before or after it, with a blue insertion marker. Focused handles also accept Up/Down keys. Existing source/target reorder endpoints persist the order before refreshing, and the client rejects cross-catalog drops.

Skills and independent expert websites store `requires_internet` with database default true. Missing columns initialize existing records to true; subsequent migrations preserve false. Legacy expert creation timestamps use the previously stored update timestamp because the original creation date was not recorded. The flag also drives intranet catalog presentation: `internetCatalogPolicy` chooses hidden or disabled entries when the existing terminal connectivity decision does not confirm access. The default is disabled. Non-internet entries remain available, connectivity refresh restores marked entries, and already running workbenches remain mounted. This controls catalog interactions without changing resource routing or automation/connector policy.

## Alternatives considered

Client-only sorting diverges between installations. Swapping nullable ranks fails when neighbors share a rank or have no rank. A migration that sets every internet flag to true on every startup overwrites administrator choices.

## Consequences

Manual moves assign explicit ranks to the full active list, including entries outside the current page. Clearing a rank returns that entry to creation-time ordering after explicitly ranked entries. The existing category-type and relation ranks retain their separate meanings. No model requests, launch credentials or skill download statistics change.

## Verification

Database tests cover legacy-column migration, repeat migration after choosing false, explicit zero and negative ranks, empty ranks, complete-list moves, invalid targets, category joins and PostgreSQL DISTINCT ordering. Client and administrator tests cover default ordering, metadata projection, keyboard and handle drag requests, and nullable form fields. TypeScript checks cover both host and client programs.

Catalog policy remains owned by the authentication network service. Client consumers invoke its injected `catalogAccess` method rather than importing a runtime helper across feature plugins. The browser bundler continues rejecting undeclared cross-plugin value imports.
