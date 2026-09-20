# Agent Note: Session persistence uses hook-free JSON serialization

Status: implemented

English | [中文](2026-09-20-hook-free-session-json-serialization.zh.md)

## Problem

`Session.append()` validates and snapshots event data and surface metadata before accepting an event, but the JSONL backend later passed those accepted objects to native `JSON.stringify`. Native serialization invokes inherited and own `toJSON` methods. An ambient prototype extension could therefore rewrite a validated value only at persistence time; one observed assistant message stored the flat provenance sequence `766..864` as `[[766,864]]`, making the next history load reject the event.

## Decision

`@deepseek-ai/dsh-session` owns `stringifyJsonValue(value)`, an iterative serializer for the existing lossless JSON value set. It snapshots the input, emits arrays and records structurally, uses native string escaping only for scalar strings and object keys, and never invokes `toJSON`. The JSONL backend uses it for session headers and every event or packed-chunk row. Append-time validation remains the first rejection point; hook-free serialization prevents the persistence step from changing an already accepted value.

## Alternatives considered

**Expand nested provenance ranges while loading.** Rejected as the primary fix because `[[start,end]]` is not a session format and could conceal other serialization-time rewrites. Pre-release storage rejects malformed current-format data instead of guessing at repairs.

**Reject the log when `Array.prototype.toJSON` exists.** Rejected because unrelated application code may install a hook, and failing every session write is unnecessary when persistence can serialize its validated value set deterministically.

**Temporarily remove prototype hooks around `JSON.stringify`.** Rejected because mutating global prototypes is process-wide and races concurrent serialization.

## Consequences

Session JSON encoding performs one additional iterative snapshot before emitting text. The extra allocation buys deterministic durable bytes independent of ambient `toJSON` hooks and applies equally to compressed and raw JSONL storage. Existing malformed logs remain invalid; no compatibility interpretation is added.
