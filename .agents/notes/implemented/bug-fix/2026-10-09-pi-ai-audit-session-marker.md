# Agent Note: pi-ai audit session marker

Status: implemented

English | [中文](2026-10-09-pi-ai-audit-session-marker.zh.md)

## Problem

The desktop gateway records user questions for administrator audit. A multi-step task sends several model requests containing the same question. Without a conversation marker, the gateway cannot apply its conversation-and-question-ordinal grouping and records separate questions.

## Decision

The [pi-ai adapter](../../../../packages/llm/llm-pi-ai/src/adapter.ts) sends `GenerateOptions.sessionId` as `x-deepseek-harness-session-id`, matching the direct DeepSeek adapter and the gateway's accepted headers. The marker is request-local, excludes conversation content, and wins case-insensitive collisions with profile headers. A request without a session omits the marker even if a profile supplies a static value.

## Alternatives considered

**Deduplicate by question text.** This merges distinct user submissions with identical text and does not establish conversation ownership. **Use a static profile header.** This assigns different conversations to the same identifier.

## Consequences

Adapter tests cover runtime-header precedence and omission. The Loader composition test observes repeated requests retaining one marker and a different conversation sending a different marker. The existing backend still owns grouping, token aggregation, and individual model-call logs. Historical records with missing session identifiers remain unchanged; deployment verification requires an updated desktop and the deployed gateway's grouping implementation.
