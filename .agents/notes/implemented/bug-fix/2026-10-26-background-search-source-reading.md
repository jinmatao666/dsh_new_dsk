# Agent Note: Keep search source reading in the background

Status: implemented

English | [中文](2026-10-26-background-search-source-reading.zh.md)

## Problem

Web search retrieves candidate sources and the agent reads them through Playwright. The desktop bundle's headed configuration opens browser windows during ordinary research. An exported session also retains the old citation instruction that explicitly rejects the source label.

## Decision

The desktop bundle selects `headless: true` for its existing browser provider. Search and source inspection remain separate operations, and tool results and failures remain visible in the conversation. Product citation guidance requires sentence-ending punctuation, a space, and `来源：` before each real clickable source link. Existing session history is not rewritten.

## Alternatives considered

Removing source inspection weakens factual verification. Hiding tool failures misrepresents evidence. Querying or controlling the user's existing browser would require additional authority and is not part of background research.

## Consequences

A rebuilt desktop and a new session are required to verify the changed behavior. Explicit headed deployments remain possible, but the desktop default does not support visible CAPTCHA or interactive login. Such failures remain failures, not verified sources. Citation formatting is model guidance, not a deterministic response rewrite.

## Verification

Provider and composition tests pin the citation instructions. The desktop config test requires headless mode; the browser Loader test reads that shipped setting and exercises real Chrome navigation, form filling and clicking without a window. Live search accuracy and installed Windows/macOS/Linux behavior still require acceptance.
