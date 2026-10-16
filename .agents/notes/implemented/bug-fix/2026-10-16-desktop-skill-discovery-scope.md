# Agent Note: Desktop skill discovery scope

Status: implemented

English | [中文](2026-10-16-desktop-skill-discovery-scope.zh.md)

## Problem

The desktop inherited generic skill discovery: shared `~/.agents/skills` and the nearest parent Git repository could introduce unrelated skills into a selected workspace.

## Decision

Add `projectRootMode` and `includeUserAgentsRoot` to the filesystem provider, keeping generic defaults `git` and `true`. The Wanwei desktop product layer selects `cwd` and `false`. Keep desktop-owned installed skills and explicit custom/bundled roots. Do not delete or migrate skills.

## Alternatives considered

Changing global defaults would affect the official CLI and other consumers. Disabling all default roots would also remove desktop installations and workspace-local skills. Neither is required for this product policy.

## Consequences

Regression tests cover exact workspace discovery, workspace switching, no-cwd lookup, shared-name collisions, parent exclusion, installed skills and explicit custom roots. A Loader composition test reads the shipped desktop patch and checks the resulting catalog. This is discovery scope, not a filesystem sandbox: explicitly configured roots and existing symbolic-link support remain available. On Windows, two existing symlink tests require permissions unavailable in this development shell; their EPERM failures are not suppressed.
