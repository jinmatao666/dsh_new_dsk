# Agent Note: Feature availability follows service reachability

Status: implemented

English | [中文](2026-10-16-service-reachability-placeholders.zh.md)

## Problem

An intranet deployment label does not prove that a configured service is unreachable. Disabling navigation prevents working internal services and local tasks from being used.

## Decision

Automation, expert and connector navigation stays clickable when the administrator exposes the entry. Local scheduling, expert RPC/native views, SkillHub RPC/installations and installed skill loading do not reject the intranet label. Other network policies, browser-assistant administrator controls and authentication remain unchanged.

Actual catalog or platform requests determine failure presentation. Experts, connectors and SkillHub share light-blue illustration styling, with expert-card, disconnected-plug and cloud-skill subjects respectively. Localized descriptions replace raw diagnostics; placeholders have no retry button. Reopening the page makes another request. Connectors have only a local demonstration directory; their check verifies the configured platform, not third-party authorization. Deployment and expert requests use the configurable `serviceTimeoutMs` limit, defaulting to 15000 milliseconds.

This partially supersedes the feature restrictions and SkillHub artwork in [Desktop network environment](../architecture/2026-09-30-desktop-network-environment.md). That note remains active for network state, link classification and search restrictions; no triplet qualifies for complete archival.

## Alternatives considered

**Disable features from the intranet label.** This mistakes an administrative classification for observed service availability and blocks local scheduling.

**Hide errors behind an empty catalog.** This suggests there is no content and gives users no retry path. **Probe an unrelated public website.** Its reachability does not establish whether the configured service works.

## Consequences

Administrative entry visibility remains independent of service failures. SkillHub failure does not block platform or installed skills. The integration is not a firewall and does not remove existing browser/search/link policies. A reachable expert catalog does not guarantee every expert website is healthy; workbench errors retain their existing presentation.

Focused tests exercise enabled intranet navigation, actual failures, recovery after reopening, local installed-skill use and scheduling in both modes. Native tests compile the removed label checks. Screenshots use the actual page components with simulated request failures, not a rebuilt installed desktop or customer network.
