# Agent Note: Resource charge points

Status: implemented

English | [中文](2026-11-16-expert-charge-points.zh.md)

## Problem

The three resource types need centrally configured prices without per-service amount overrides or duplicated protocols. Skill pricing must remain automatic for newly added skills.

## Decision

Knowledge-wide charge points use `kind=knowledge_service` and the fixed `item_id=default` on the same quote, reservation, settlement and administration routes. They do not require a placeholder library. Current platform users pay from their own accounts; expert-scoped credentials cannot access this scope. The knowledge owner retains service entitlement checks and chooses the charging trigger. The Go transport supports both library and service scopes without automatically adding charges to existing business handlers. Rule kind storage accommodates the service identifier.

Experts, skills and knowledge libraries share the configured-price HTTP billing API and one rule/task store. Resource kind, item ID and immutable charge point ID identify the price. Expert identity is redeemed through existing server credentials; skill calls carry the current account; the knowledge request forwards its existing authenticated headers to the loopback HTTP API. Payer identity is never supplied as an arbitrary user ID. Caller-supplied developer prices and the Python SDK are retired.

Every new skill creates a default point transactionally; startup initializes existing skills from their legacy prices. Concurrent initialization is arbitrated by the unique resource/action constraint. The skill executor resolves the default ID instead of hard-coding it. Other business nodes explicitly configure their generated IDs. Separate pricing dialogs keep skill content editing independent of billing. Knowledge administration and business charging triggers remain for the knowledge team.

Disabled points execute for zero cost. A disabled platform policy returns an explicit exempt response without requiring a valid price configuration; callers must continue business and skip settlement. Already reserved tasks retain their monetary and name snapshots. Failed or cancelled work releases reservations; successful work with uncertain settlement requires querying or repeating the original result submission, never a new charge. Historical tasks without name snapshots keep their original labels.

## Alternatives considered

Passing amounts from each service would bypass centralized pricing. Separate SDKs would create competing integration instructions, so the HTTP document is canonical. The Go knowledge helper is only an HTTP transport over that protocol. Loopback transport adds a bounded request; it forwards user credentials solely to the local configured service port and refuses redirects. Ordinary knowledge access is still enforced by its existing owner logic. Preparing the adapter does not charge a question or change RAGFlow billing.

## Consequences

Deleting a point hides it from administration and atomically stores a disabled, zero-price tombstone with its original resource binding. Existing integrations keep executing for free, while unknown or cross-resource IDs still fail. Deleted defaults are not recreated by skill initialization. Version checks prevent stale edits or deletes from reviving a point; existing tasks settle their original snapshots.

Disabled accounting and disabled points must not stop business. Knowledge owners still implement their own charging triggers and retain their existing access authorization. No long-task renewal or task-secret recovery is added.

## Verification

Controller tests cover all three resource kinds, stable skill defaults, price/name snapshots, disabled free execution, global exemption, original-price settlement and duplicate results. Expert redemption tests exercise scoped credentials, revocation and expiry. Knowledge transport tests verify authenticated quote/reserve/result HTTP calls. Skill executor tests cover point resolution, exemption, insufficient balance and unchanged execution triggers. Admin UI tests exercise isolated dialogs and the skill row entry before Delete. Production expert business nodes and future knowledge policies still require end-to-end deployment integration.
