# Agent Note: Independent Wanwei feature plugins

Status: implemented

English | [中文](2026-10-10-independent-wanwei-pages.zh.md)

## Problem

One skill-marketplace mount registers four unrelated business pages. Disabling the marketplace therefore removes experts, connectors and automations, and module-global callbacks can retain another mounting instance's state.

## Decision

The product composes four independent business packages: skill-marketplace, expert-library, connectors and automations. Each package registers only its own sidebar entry and page, owns its state and callbacks, and can be disabled independently through its Cordis row. Shared authentication and model execution remain in their existing provider packages.

The shared feature-panels module owns presentation helpers, not business registrations. Consumers declare its Client export in dsh.client.external and keep its provider row mounted. Opening a page broadcasts a browser-local navigation event; each independent controller closes itself when another page opens. Context disposal closes the page, clears subscribers and removes event listeners. Logout closes all live pages. Resizing and owned dropdowns do not change navigation.

Expert workbenches retain their native tab lifecycle and ticket validation. Intranet mode disables experts; the marketplace preserves platform/local skills while disabling SkillHub. [Environment-specific feature settings](../feature/2026-10-10-environment-feature-visibility.md) independently control connector and automation entry visibility. Connector and automation interactions remain demonstrations, not new integrations or scheduling.

## Alternatives considered

**Keep four controllers in one plugin:** independent UI state cannot provide independent plugin enablement or unload, so this retains the ownership problem.

**Copy page chrome into every plugin:** this removes a shared UI dependency but duplicates navigation fixes and visual rules. A presentation-only module preserves reuse without business-to-business dependencies.

## Consequences

Product composition, workspace exports and type references explicitly include the new packages. Official shell behavior is unchanged. Shared presentation is an additional provider dependency, but no business plugin requires a sibling business plugin.

Controller tests exercise independent instances, switching, disposal, logout, subscriber errors and network-policy presentation. The product-profile browser regression exercises all four entries and resizing. Native expert Webview acceptance on UOS/macOS/Windows remains a separate platform check; jsdom and browser tests do not claim native execution coverage.
