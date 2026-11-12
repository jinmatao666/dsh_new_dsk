# Agent Note for operations subscription knowledge credits

Status: implemented

English | [中文](2026-11-12-operations-knowledge-credits.zh.md)

## Decision

OneAPI owns integer hundredth-credit prices and immutable usage receipts. Subscriber debit, maintainer credit and platform remainder commit in the same database transaction. A completed answer uses its displayed RAGFlow citations as the authoritative list of chargeable files. A paid preview creates a rolling 24-hour access window. Request identities protect retries from duplicate settlement.

The knowledge page buffers subscription answers until settlement completes. A pending upstream conversation can contain an unpaid answer, so the history endpoint withholds that conversation until the user clears it. Composer retrieval lacks final citation identities and directs paid subscription questions to the knowledge page. The [knowledge-base README](../../../../packages/wanwei/knowledge-base/README.md) describes owner pricing and the user flow.

## Verification

Focused tests cover edition and owner exemptions, insufficient balance rollback, rounding across cited files, the preview window, download retries, publication pricing, the owner-only catalog after approval, and workbench split settings. The publication page keeps price save errors in the pricing dialog and opens the application form after a successful save.
