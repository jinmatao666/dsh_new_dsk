# Agent Note: Desktop credential and session recovery

Status: implemented

English | [中文](2026-09-21-desktop-credential-and-session-recovery.zh.md)

## Problem

An installed desktop build can encounter a credentials document written by a different build with a `version: 1`, `refs`, and `records` wrapper. The flat credentials provider rejects `version` as a non-string credential, preventing account logout and other credential writes. A search request event omitted from the generated known-event list also makes an otherwise valid conversation history unreadable.

## Decision

The credentials provider recognizes only the exact legacy wrapper, copies the original to a unique adjacent backup, and atomically writes the `refs` entries in its flat format. Boot migration runs under the writer lock and re-reads the document there; a credential write also migrates a legacy document found under that lock. Invalid documents outside this recognized format still fail.

The OneAPI search request is included in the generated persistence catalog. New instances carry `ignorable: true`: readers that do not know this observational event can skip it without losing conversation state. The current reader recognizes earlier unmarked instances by type.

The desktop composer accepts browser drops with a non-empty file list even when WebView omits the `Files` transfer type, and coalesces browser and native notifications of one drop.

## Alternatives considered

**Accept any wrapper or unknown credential field.** Rejected because it could silently discard a credential or misinterpret unrelated data.

**Skip every unknown session event.** Rejected because unknown required events may change reconstruction of the conversation.

## Consequences

An upgrade preserves credentials and an original backup, while account logout can remove the token after a legacy writer restores the wrapper. Existing search histories containing the event load in a build with the regenerated catalog. An older build can skip new search records only when they carry the ignorable marker; it still rejects unmarked records it does not know.
