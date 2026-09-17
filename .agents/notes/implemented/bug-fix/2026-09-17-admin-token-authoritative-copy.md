# Agent Note: Administrator token copy reads the authoritative secret

Status: implemented

English | [中文](2026-09-17-admin-token-authoritative-copy.zh.md)

## Problem

The administrator user detail page offers a copy action for each model-access token. A list row is presentation data and may be stale, absent, or redacted, so copying its embedded `key` can report success without placing the current usable secret on the clipboard.

## Decision

The administrator token API exposes an authenticated lookup scoped by both user id and token id. The copy action requests that record immediately before copying and prefixes the returned key with `sk-`. Missing records and clipboard failures remain visible errors; the UI never reports success before the clipboard operation completes.

## Alternatives considered

**Copy the key carried by the token list** — rejected because list responses serve table rendering and do not establish that the embedded secret is current and complete at the time of the action.

**Expose one unscoped token lookup to administrators** — rejected because binding the lookup to the selected user prevents a token id from returning a secret outside that user row.

## Consequences

Copy performs one additional authenticated request and returns the full secret only to an administrator who can already manage that user's tokens. The list remains responsible for names, quotas, status, and expiry rather than acting as the source for a credential copy.
