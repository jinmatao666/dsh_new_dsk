# Agent Note: Reversible Chinese conversation localization

Status: implemented

English | [中文](2026-09-29-chinese-conversation-plugin.zh.md)

## Problem

The desktop needs Chinese-first communication and localized interaction labels without coupling product translations to official packages or rewriting durable conversation evidence.

## Decision

The product bundle mounts the independent [Chinese plugin](../../../../packages/wanwei/chinese/README.md). It registers a prompt section and a selectable language with official Chinese fallback. Official permission, command-menu and reasoning-level views pass only their interaction labels through the existing locale translator. Missing translations return the original text, preserving the application without the plugin. The plugin owns all new Chinese wording and selection cleanup.

## Alternatives considered

**DOM replacement:** discarded because it depends on markup and can overwrite conversation content or collide with React updates. Runtime dictionaries participate in the existing locale revision notifications.

**Replacing personas or translating tool results:** discarded because it changes expert instructions and model-visible evidence. An additional prompt section leaves both intact and honors complete-persona exclusion.

## Consequences

The product defaults to the Chinese pack. Disabling its Loader row removes both contributions and restores the preceding language unless the user has changed it. Machine values and menu execution routes remain unchanged. Exact matching leaves unknown descriptions untranslated; complete personas retain their official isolation. Historical Chinese answers remain Chinese after removal.

## Testing

Host tests pin the policy text and verify persona preservation, complete-persona isolation and disposal. Client tests verify official fallback, translated interaction labels, unknown-text fallback and language restoration. A product-profile smoke checks that the desktop loads with the plugin enabled and disabled. Existing permission, command and model-selector tests verify unchanged execution behavior.
