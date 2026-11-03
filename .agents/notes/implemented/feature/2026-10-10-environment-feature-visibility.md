# Agent Note: Environment-specific feature visibility

Status: implemented

English | [中文](2026-10-10-environment-feature-visibility.zh.md)

## Problem

Administrators need different automation, connector and knowledge-base entry visibility in Internet and intranet deployments. One global switch or a fixed intranet block cannot represent deployment-specific availability.

## Decision

System Settings stores independent booleans in SystemDeploymentSettings.features, keyed by environment and entry (automation, connectors, knowledge bases, land market, policy encyclopedia). Existing records without features resolve to automation and knowledge bases enabled in both environments, connectors enabled only on Internet, and land market plus policy encyclopedia disabled. Explicit incomplete or non-boolean settings are rejected. The public desktop-config response allowlists both environment rows and contains no private configuration. Portal page URLs for land market and policy encyclopedia live in `featurePages` and are published with the same response; see [land market and policy encyclopedia entries](2026-11-03-land-market-policy-encyclopedia-entries.md).

The authentication plugin reads these settings during startup and login refresh. Each independent business plugin supplies its own visibility observable to feature-panels. Hidden actions render no placeholder and close their open overlay. The existing sidebar keeps Settings anchored at the bottom, allowing the remaining actions to move downward without CSS changes. Enabling an intranet connector does not override outbound network restrictions or create a real connector integration.

## Alternatives considered

**One switch for both environments:** rejected because it cannot enable intranet while disabling Internet.

**Gray disabled entries:** rejected because administrators explicitly want unavailable entries removed. Expert and SkillHub network policies remain separate.

## Consequences

The backend and desktop both require an updated release for configurable visibility. Changes apply on startup, login and existing authentication refreshes on focus, visibility and a five-minute timer; no additional poller is installed. No database table, sibling-plugin dependency or official shell patch is added. Focused API, admin UI and Client tests exercise defaults, independent values, malformed configuration, hidden actions and page closure. Native platform acceptance remains a deployment check.
