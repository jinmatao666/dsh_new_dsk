# Agent Note: Private-network dependency feedback

Status: implemented

English | [中文](2026-10-10-intranet-dependency-feedback.zh.md)

## Problem

Private-network users can edit and run scripts, but unavailable dependencies can cause repeated public installation attempts and unclear task status. Disabling local execution would also disable legitimate internal business tasks.

## Decision

Keep this policy in the Wanwei authentication/network plugin. A private-network-only system-prompt section tells the model to inspect installed dependencies, prefer offline packages and internal mirrors, and explain a blocked task in Chinese only when an essential dependency has no alternative. Confirmed mode changes replace the section through the existing settings scope; plugin disposal removes it.

The prompt ownership and ordinary tool-result feedback remain current. [Failure-driven dependency feedback](2026-10-11-failure-driven-dependency-feedback.md) supersedes the download-denial decision: configured private-network mode permits actual downloads, and post-execution diagnostics determine failure guidance. Ordinary tool results carry the reason into conversation records and model context; there is no separate popup or fabricated assistant message. Internet mode remains unchanged.

## Alternatives considered

**Popup only.** The model would not receive the reason and could retry or misreport success.

**Disable all shell execution.** This would prevent installed dependencies, offline processing and internal mirrors from supporting legitimate tasks.

**Claim complete network isolation.** A command recognizer cannot cover arbitrary scripts or shell syntax. Network isolation remains an infrastructure responsibility.

## Consequences

The policy is best-effort application feedback, not a firewall. Model wording follows prompt guidance rather than deterministic UI text. Current failure categories and focused verification are owned by the [failure-driven feedback decision](2026-10-11-failure-driven-dependency-feedback.md). Tests do not establish live-model response wording.
