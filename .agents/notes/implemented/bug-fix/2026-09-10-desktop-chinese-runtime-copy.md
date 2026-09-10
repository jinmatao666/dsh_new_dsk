# Agent Note: Desktop Chinese runtime copy
English | [中文](2026-09-10-desktop-chinese-runtime-copy.zh.md)

Status: implemented

## Problem

Model-authored tool summaries, approval reasons, and question prompts can arrive in English even when the desktop product is configured for Chinese users.

## Decision

The desktop profile instructs the model in Simplified Chinese for every user-visible natural-language field. Client components retain Chinese model copy and replace non-Chinese tool summaries, approval reasons, question titles, question detail, and option copy with localized Chinese fallback text. Commands, paths, package names, identifiers, and original error text remain verbatim.

## Alternatives considered

**Translate arbitrary text in the client.** The client has no reliable translation service, and an implicit remote translation call would add latency, privacy exposure, and a new failure mode to every conversation update.

**Trust the system prompt alone.** A model can still emit non-compliant text, so presentation components provide a deterministic fallback for short workflow chrome.

## Consequences

Users see Chinese workflow controls even when a model produces English metadata. The precise English wording is intentionally not shown in those short chrome fields; the original command and other technical artifacts remain inspectable.
