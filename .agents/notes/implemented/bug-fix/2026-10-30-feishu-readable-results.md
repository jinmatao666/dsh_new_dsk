# Agent Note: Render Feishu results as native rich text

Status: implemented

English | [中文](2026-10-30-feishu-readable-results.zh.md)

## Problem

Feishu received raw Markdown as text; users saw formatting delimiters. Scheduled messages also exposed technical status prefixes, and normal replies truncated long content.

## Decision

Share native post Markdown encoding across bot replies, synchronized messages, scheduled results and inline CLI text-send shortcuts. Preserve explicit rich messages and file/stdin inputs. Split long bot replies and scheduled messages by paragraphs or lines when possible, maintaining Unicode and repairing code fences. Ordinary messages receive no extra heading or footer. Scheduled results use task headings and timestamp footers without success labels; exceptional runs retain reasons.

## Alternatives considered

Removing Markdown punctuation globally corrupts formulas, paths and code. Adding task labels to ordinary replies changes the user's message. Sending a summary in place of the body loses information.

## Consequences

No extra model request is needed. Authorization and recipient selection remain unchanged. File/stdin content and raw API invocations remain under their caller's explicit message format. API payload fixtures do not prove rendering on a real mobile client; no live test message was sent.

## Testing

Focused tests verify rich payloads, inline send/reply conversion, explicit rich-content preservation, complete Unicode delivery, repaired code fences, runtime headings, absent success labels and saved retry text. Connector authorization and channel tests pass. Type checking and focused lint pass.
