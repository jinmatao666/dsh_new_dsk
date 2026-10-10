# Agent Note: Private-network dependency feedback

Status: implemented

English | [中文](2026-10-10-intranet-dependency-feedback.zh.md)

## Problem

Private-network users can edit and run scripts, but unavailable dependencies can cause repeated public installation attempts and unclear task status. Disabling local execution would also disable legitimate internal business tasks.

## Decision

Keep this policy in the Wanwei authentication/network plugin. A private-network-only system-prompt section tells the model to inspect installed dependencies, prefer offline packages and internal mirrors, and explain a blocked task in Chinese only when an essential dependency has no alternative. Confirmed mode changes replace the section through the existing settings scope; plugin disposal removes it.

The existing tool pre-execution waterfall denies recognized direct package-manager commands with public sources. Explicit offline options and internal sources remain usable. Configuration files and unresolved variables are deferred to the package manager rather than guessed. The post-execution waterfall preserves original shell output and appends Chinese guidance for recognized missing dependencies or dependency-download failures. Ordinary tool results carry the reason into conversation records and model context; there is no separate popup or fabricated assistant message. Internet mode remains unchanged.

## Alternatives considered

**Popup only.** The model would not receive the reason and could retry or misreport success.

**Disable all shell execution.** This would prevent installed dependencies, offline processing and internal mirrors from supporting legitimate tasks.

**Claim complete network isolation.** A command recognizer cannot cover arbitrary scripts or shell syntax. Network isolation remains an infrastructure responsibility.

## Consequences

The policy is best-effort application feedback, not a firewall. Local configuration may resolve to a public source; such commands are not comprehensively prevented. Model wording follows prompt guidance rather than deterministic UI text. Seventeen dependency-policy tests, fifteen existing network tests and one real Loader composition test passed, together with the Host TypeScript build and package bundle. Tests do not perform real dependency downloads or establish live-model response wording.
