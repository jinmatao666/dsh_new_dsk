# Agent Note: Collapse reasoning without hiding reply content

Status: implemented

English | [中文](2026-11-05-collapse-reasoning-on-reply.zh.md)

## Problem

Reasoning used a persistent local toggle and did not collapse at the first reply token. Turn folding becomes authoritative only after turn closure, so using a provisional answer boundary could hide user-facing body text.

## Decision

Reply rendering stays independent. Before reply content exists, streaming reasoning is expanded. The first visible reply changes the reasoning phase to collapsed; manual expansion then survives further tokens. Completed reasoning defaults to collapsed. Chat mount/session transitions clear process toggles and session-keyed node seats reset local disclosures. Existing completed-turn boundaries and partial-history safeguards remain intact.

## Alternatives considered

Applying completed-turn folding to a running turn risks classifying narration or a future answer as process.

## Consequences

Only reasoning is automatically collapsed during streaming; tool/process folding waits for a verified completed answer. Restoring a view intentionally discards prior manual expansion.
