# Agent Note: Moderated knowledge publication and administrator inbox

Status: implemented

English | [中文](2026-11-12-knowledge-publication-inbox.zh.md)

## Problem

Personal-library owners need to offer their datasets to other users without exposing documents before an administrator reviews them. Subscription review also needs a visible place alongside publication work.

## Decision

The operations edition accepts owner-only personal-library publication requests. Pending and rejected requests leave access unchanged; only an administrator may approve sharing. Direct target selection and retained personal ownership follow [owner-preserving publication](2026-11-12-knowledge-publication-personal-origin.md). The government edition rejects submission and publication review.

The administrator-only knowledge inbox groups publication and subscription tasks, shows pending counts and offers status filters. The publication review dialog presents the requested scope and application note. The application-scoped document routes allow read-only access to a pending request's documents without granting ordinary administrators access to the entire personal-library catalog. Rejecting publication requires a reason. Each library stores its latest publication request; resubmitting after rejection replaces the prior review fields. Deleting the library deletes its request.

The inbox replaces the standalone review entry from [knowledge library subscription](2026-10-23-knowledge-library-subscription.md), which still owns grants, plaza discovery and unsubscribe semantics. Both subscription list and decision endpoints require administrator authorization.

## Alternatives considered

Publishing at submission time exposes personal data before moderation. Reusing a subscription application confuses changing a library’s visibility with granting a viewer access. Allowing owners to settle publication requests removes administrator moderation. An unrestricted administrator catalog is unnecessary for inspecting a particular pending request.

## Consequences

Owners must review the whole library before requesting publication; approval covers existing and future content. Public conversion makes it readable by all users. Subscription conversion lists it on the plaza while retaining grant checks for other users. Desktop state and rejection reasons come from saved requests. The latest-request storage does not retain every rejected attempt as a separate audit record.

Model and HTTP tests verify privacy before approval, both target types, revalidation, resubmission, administrator authorization and edition rejection. Client tests cover persisted pending state and rejection feedback; the workbench has a pending-inbox output snapshot. The local refresh script keeps Go linker temporary files on the repository drive.
