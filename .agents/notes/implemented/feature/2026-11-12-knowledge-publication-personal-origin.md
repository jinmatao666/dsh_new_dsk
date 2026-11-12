# Agent Note: Owner-preserving knowledge publication

Status: implemented

English | [中文](2026-11-12-knowledge-publication-personal-origin.zh.md)

## Problem

Choosing an administrator category confuses publishing a library with filing content. Moving the library out of Personal removes the owner's maintenance entry and makes it harder to manage shared content.

## Decision

Publication requests name a public or subscription target directly, without category selection. Administrator approval writes `KnowledgeBase.PublicationScope`; kind remains personal and category remains zero. The same dataset stays in the owner's Personal group and also appears in Public or Subscription. Public sharing permits reading by every user; subscription sharing requires a grant for other viewers and remains discoverable on the plaza. Guest write operations stay forbidden; owner and root-operator editing remain available.

The desktop uses one compact Publish menu and a destination summary in the application dialog. The knowledge workbench keeps its white-icon inbox button and pending badge, without a catalog reminder banner. Its inbox has a dedicated heading, segmented task tabs, a white list panel and an illustrated empty state.

This supersedes category-based publication in [moderated publication and inbox](2026-11-12-knowledge-publication-inbox.md). That note retains administrator moderation, edition restrictions, application-scoped document inspection and latest-request storage. Startup restores personal origins for previously approved publication records while preserving their approved sharing target.

## Alternatives considered

Copying a dataset for sharing duplicates storage and lets content diverge. Moving the owner’s resource into a shared category hides the personal maintenance path. Allowing public or subscription viewers to edit the personal original grants more than read access.

## Consequences

Updates to the original library also update its shared entry. The two navigation entries identify the same library; they are not copies. Tests verify both sidebar entries, preserved owner editing, read-only guest behavior, no category picker, public visibility, subscription approval and cancellation, plus restoring existing approved records. The workbench output snapshot covers the dedicated inbox layout.
