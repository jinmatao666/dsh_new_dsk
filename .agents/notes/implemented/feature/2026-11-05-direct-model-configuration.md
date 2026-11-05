# Agent Note: Direct model configuration and draft testing

Status: implemented

English | [中文](2026-11-05-direct-model-configuration.zh.md)

## Problem

The composer requires a second click to reach model choices. Creating a custom route hides the required model row behind an add action and exposes routing identity to desktop users.

## Decision

The composer opens the model list directly and keeps reasoning effort accessible inside it. The desktop custom form starts with one model name and alias, followed by URL and credential. The model name remains the wire ID. Protocol selection is collapsed and defaults to OpenAI completions. Internal provider IDs remain generated and stable.

A testModel Remote tests unsaved values from the Host without committing settings or credentials. It supports OpenAI completions/responses and Anthropic messages, preserves proxy prefixes, refuses redirects, and applies cancellation plus a 30-second timeout. Error bodies and supplied credentials are not echoed. The UI clears success after changing the draft. Both the save button and write handler require a successful test matching the current draft, including credential-only retries.

## Alternatives considered

Using model discovery as a connection test would fail for chat-only endpoints and would not prove the selected model can respond. Browser-side requests would depend on upstream CORS permissions.

## Consequences

A test incurs one model request. Test success verifies the draft endpoint rather than saving it or proving all model capabilities. Other wire protocols remain configurable but the test explicitly refuses unsupported protocols.
