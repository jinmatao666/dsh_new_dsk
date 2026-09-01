# Agent Note: Desktop skill installation and dependency grant

Status: implemented

English | [中文](2026-09-01-desktop-skill-install-and-dependency-grant.zh.md)

## Problem

Desktop users need an install action in the skill marketplace that creates a skill the local runtime can discover. Workspace Write sessions also need an explicit first confirmation before downloading a missing dependency without repeatedly interrupting one task after that consent.

## Decision

The desktop marketplace writes each installed skill as `SKILL.md` under the current user's `.dsh/skills/<slug>/` directory through a native Tauri command. The filesystem skill provider already watches that user root, so a newly created conversation discovers the installed skill through the ordinary catalog and invokes it by its generated `/market-<slug>` name. Removal uses the same constrained directory and refuses symbolic-link targets.

`ApprovalService` optionally remembers an allowed package-manager escalation for one live session. It recognizes only `pip`, `npm`, `pnpm`, and `yarn` install commands recorded on `bash` or `pwsh` tool calls. The first matching escalation reaches the normal human approval channel; later matching escalations receive an in-memory one-shot result without another prompt. Desktop enables this option through `DSH_DEPENDENCY_INSTALL_APPROVALS=session-once`.

The deliverable row excludes helper source extensions and uses successful mutation locations or explicit terminal write output as its evidence. It does not infer artifacts from assistant prose.

## Alternatives considered

**Keep marketplace installation in browser storage** — rejected. A browser-only installed marker cannot place a skill in the host catalog or make it callable by a new conversation.

**Grant all later sandbox escalations after one dependency approval** — rejected. A package installation grant must not authorize unrelated commands or filesystem actions.

**Remember dependency grants across sessions** — rejected. A new task needs a fresh user decision and session persistence would introduce revocation and auditing requirements.

## Consequences

Installed marketplace skills are local to the desktop user and become available after the next conversation catalog fetch. The Marketplace UI can still render in a non-desktop browser, but its install action reports that native installation is unavailable.

The dependency convenience applies only after an existing escalation path and does not change Full Access behavior. It reduces repeated prompts without widening the session's general sandbox policy.

## Verification

Focused approval and deliverable tests cover the session grant and source-file exclusion. Type checking covers the marketplace, approval, and deliverables packages; `cargo check` covers the desktop native commands.
