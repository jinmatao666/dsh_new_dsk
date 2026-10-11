# Agent Note: Failure-driven dependency feedback

Status: implemented

English | [中文](2026-10-11-failure-driven-dependency-feedback.zh.md)

## Problem

The configured intranet environment does not prove Internet connectivity is absent. Denying dependency downloads by mode prevents usable tasks, while missing PowerShell feedback leaves Windows failures unexplained. Environment-repair scripts can also appear as deliverables.

## Decision

The Wanwei network plugin permits package-manager execution in either mode. Only intranet mode appends failure guidance to recognized Bash, PowerShell and terminal diagnostics. Original output remains intact; missing modules, connection failures and unavailable packages receive distinct feedback. Permission and syntax errors alone do not imply networking failure. The model is guided to give a short dependency/cause/recovery response, stop only blocked dependent steps, and avoid unrequested environment repairs or source changes. This partially supersedes [the download-denial decision](2026-10-10-intranet-dependency-feedback.md); that note retains prompt ownership and no-popup rationale.

The generic deliverables selector recognizes dot-prefixed temporary names such as `.tmp-check.py`. It hides them from presentation without deleting files or excluding legitimate delivered source files, consistent with [final deliverable selection](2026-09-30-final-deliverable-selection.md).

## Alternatives considered

**Block all Internet installs in intranet mode.** The user explicitly permits downloads when connectivity exists; a deployment label is not evidence of a failed download.

**Only instruct the model in the user message.** Shell failure feedback must also work for ordinary requests without a special test prompt.

**Force a modal or fixed assistant reply.** Existing tool results already carry durable model-visible facts; concise assistant wording remains model-guided without changing the official loop.

## Consequences

Recognizers are best-effort and cannot classify every custom diagnostic. A package-not-found message alone does not establish connection refusal. Successful installs and Internet-mode output are unchanged. Focused tests pin all five shell/output tool names, classification, permission negatives, mode changes, unload and a Loader-composed PowerShell result snapshot. Real model prose still requires desktop acceptance; no prompt guarantees a fixed number of calls. Temporary file filtering changes presentation only.
