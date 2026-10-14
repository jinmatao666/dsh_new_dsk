# Agent Note: Local automation execution

Status: implemented

English | [中文](2026-10-12-local-automation-execution.zh.md)

## Problem

The desktop automation page cannot deliver scheduled work if task switches only change mounted UI state. Users need persistent configuration and evidence of actual execution rather than sample cards or fabricated success.

## Decision

The independent automations plugin owns local task storage, account-filtered RPC, due-slot claiming and run records. Existing Session Controller and Agent services own execution. Every run starts a fresh Session in the configured working directory using the default model and workspace-write permissions; approval requirements remain intact.

Execution Sessions use the existing durable archive set to stay out of sidebar groups, flat lists and search, including when opened from run records. The plugin archives new Sessions before prompting and retained record Sessions at startup. It skips definitively missing Sessions but propagates storage failures. This avoids a separate Session format or client-only title filtering; execution does not register Workspace folders. History selects reserve label/chevron spacing without changing the shared Select primitive.

The scheduler commits the next occurrence and a running record before execution. File-lock serialization prevents concurrent claims for one task across desktop processes. Startup and account changes skip missed slots; logout and disposal stop execution admission. Completed turn records determine success, and a Session flush precedes final record publication.

The [independent page decision](../architecture/2026-10-10-independent-wanwei-pages.md) remains active for package ownership and presentation. This note supersedes only its demonstration-only automation behavior; connectors remain separate.

Creation entries remain client-owned. Templates stage paused drafts for explicit review, not stored examples. Creation from a task clears the current selection and stages a new-conversation prefix without sending or saving. This navigation entry does not itself expose a conversational scheduling tool.

Creation controls use five Lucide 0.468.0 SVG glyphs with retained ISC attribution. Fixed icon boxes and a centered 32-by-36 trigger avoid font-baseline drift; menu labels retain normal accessible names. Browser component checks verify zero chevron-center offset at wide and narrow widths without using real task data.

Workspace selection uses the Workspace Controller and shared directory picker. The editor stores the selected path without navigating or registering a Workspace; cancellation and failure preserve the draft. The run ledger derives elapsed time from committed timestamps rather than claiming successful artifacts. Presentation does not add a full-access preset, finite validity or notification delivery to the execution contract.

Task and record searches expand within their header. Ledger rows open their linked Session by pointer or keyboard; failure details and delete controls do not navigate. Account-scoped record deletion uses the existing locked store and rejects running records inside the mutation, preserving duplicate-run exclusion across processes. Confirmation states that tasks, Sessions and files remain; deleting history never stops an execution. Component tests cover search placement, navigation and confirmation; the Loader composition test covers durable deletion, account rejection and running-record rejection.

## Alternatives considered

**Keep the demonstration:** this cannot satisfy the requested real scheduling and hides the distinction between configured work and executed work.

**Add cloud scheduling:** this requires a separately authorized execution environment and access to user files. The requested scope is local execution.

**Implement another Agent loop:** this duplicates model, permission and Session behavior. Scheduling delegates to the existing public controller instead.

## Consequences

Tasks survive page closure and desktop restart, but the desktop must remain running and authenticated. Missed work is not replayed. Storage corruption fails explicitly; stale file locks require operator recovery. A completed Agent turn is not independent proof that a generated document is semantically correct.

Focused tests verify empty initial UI, failed writes, persisted account isolation, weekday recurrence, Loader mounting, real Session and Agent execution, scheduled claims, duplicate-run rejection and timeout records. The external model response and desktop transport are test doubles; live-model and native desktop acceptance remain manual deployment checks.
