# Agent Note: Retain automation deliverables before completion acknowledgements

Status: implemented

English | [中文](2026-10-30-automation-delivery-body.zh.md)

## Problem

The supplied session generated ten book recommendations alongside a completion checkpoint, then a short final acknowledgement. Delivery selected only the last assistant message and omitted the actual recommendations.

## Decision

Collect nonempty user-visible text blocks from assistant messages in the run-owned fresh Session, in order, suppressing exact duplicate blocks. Exclude tool, reasoning and user content. Keep the existing checkpoint-summary fallback, delivery persistence and retry behavior.

## Alternatives considered

Choosing the longest message can lose multi-part results. Using checkpoint summaries repeats the original loss of detail. Asking the model to repeat all output does not repair extraction reliably.

## Consequences

Deliveries can contain intermediate user-visible text as well as the final result. Existing connector splitting handles long messages. Sessions remain isolated per execution; delivery retry reuses persisted text without model execution.

## Testing

Real-loop runtime tests include recommendations in the same response as the completion tool call followed by a short acknowledgement, and verify delivery-only retry. Replaying the supplied log retains both text blocks including the first and tenth book. No live connector message was sent during verification.
