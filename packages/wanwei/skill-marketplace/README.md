---
description: "Use the Wanwei desktop skill market while the official DSH skill runtime remains responsible for skill execution."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-skill-marketplace

English | [中文](README.zh.md)

## Summary

Staged and Session-backed skill references share a name button that opens details and a red top-right cross that removes only the reference, not the installation. Draft text remains intact when opening or closing details. Published skill details display the administrator's `usage_example` text below the description, preserving line breaks; empty examples are omitted. Updating this metadata does not require reinstalling the skill.

Use skill stages an editable draft without creating a directory or inheriting the previous conversation's Workspace. Its first send allocates a persistent timestamped directory through the desktop shell. The normal Workspace registry and Session controller publish the resulting Workspace in the sidebar and execute the skill there. Choosing a Workspace manually after launching the skill and before sending bypasses automatic allocation. Failed creation keeps the draft and reuses any directory already allocated on retry.

Installed platform, personal and SkillHub skill details offer Open directory beside Use skill. The desktop resolves the installation slug within its local skills root and opens the operating-system file manager; uninstalled skills do not show this action. The action does not inspect API keys or create or modify configuration files.

Before Workspace selection, the staged skill label and editable question share one inline flow. Labels are not percentage-truncated; the question follows the label with a small gap, and subsequent lines use the full text area. Selecting a Workspace settles the same slash token into the ordinary editor reference without changing submitted text.

The Wanwei desktop can browse published skills, manage local installations and review personal uploads through this plugin. The official DSH runtime discovers and executes installed skills. Expert workbenches, connectors and automations belong to independent plugins, not this market.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Wanwei desktop bundle mounts this Client plugin after the official browser UI; it is not a standalone application.

### When to choose it

Use the Wanwei product profile when the desktop needs the OneAPI-backed catalog and local skill installation. Official DSH skill packages still discover and run installed skills.

The market contains official-platform-only recommendations, all published platform skills and a separate SkillHub section. Each catalog owns its Enter-submitted search, category, sort and twelve-card pagination in a compact toolbar; platform search hides recommendations and does not filter SkillHub. Popular sorting uses download counts; platform latest-update sorting requires backend timestamps and keeps undated entries in server order after dated entries. SkillHub cards share the platform download glyph without a repeated source badge, and details open at page level while preserving list position. My installations includes local SkillHub receipts and supports offline use, removal and manual updates. [The SkillHub adapter](../skillhub/README.md) owns upstream requests and limits.

Platform and SkillHub toolbars show nearby page numbers, the first and last page, and a bounded page-number jump. Paging, search and filters preserve the market panel's scroll position. SkillHub keeps the previous cards visible while the requested page loads so the panel does not collapse between requests.

Recommendation cards show verified download counts with the same glyph and metadata styling as platform cards. They open details on click and contain no installation, removal or update controls; the installed badge below the skill icon remains.

Platform download counts include each successful installation or update, including reinstalls by the same account. The administrator's installation column counts each account once per skill. Reporting failures leave the local installation intact and display a download-count synchronization error; they are not automatically retried. SkillHub counts retain the upstream definition.

Catalog and installation filters share the rounded dropdown control with desktop settings fields. The list is positioned above or below its trigger according to available space, without the operating system's square native popup.

Platform category choices come exclusively from backend category management. The client does not insert a fixed generic category; administrator-configured categories remain available under their actual names.

Dragging either column-width handle preserves the active skill market and its local state. Selecting a sidebar navigation action still leaves the panel; changing layout geometry does not select a conversation.

My installations combines platform/local skills and SkillHub receipts into one twelve-card list. Matching cross-source installations appear as one card in the combined view; the source selector still exposes each installation separately. Its toolbar contains Enter-submitted search, a single source selector and pagination; filtering resets to page one, and removal clamps the page to the remaining results. Native skill-catalog changes refresh platform installation states alongside SkillHub receipts, so removal does not leave a stale installed card. Cards open skill details; removal and updates are available there instead of on the cards. This view reads local receipts without requesting the upstream catalog.

### Composition

The plugin owns only its skill entry, catalog, installations, uploads and details. It shares page chrome and notices with [feature-panels](../feature-panels/README.md), while its controller and remote callbacks belong to its own mounting instance.

The personal-skill import dialog presents visibility and skill source as peer fieldsets. Directory and ZIP controls share compact button styling; the selected path occupies a separate full-width row, with overflow truncation and a full-path tooltip. Header-only styles do not apply to source controls, and short windows use tighter spacing.

Platform and SkillHub operations share restrained, top-centered notices. SkillHub progress remains visible until completion; installation, update and removal results appear as soon as the native operation succeeds, before refreshing local receipts. A failed refresh reports that the operation completed but the list could not refresh.

Starting an installed skill stages its slash token and friendly name. The composer displays a compact inline skill chip beside the editable question; Session-backed chips serialize to the same slash token. Product styling remains in the Wanwei UI packages.

The product bundle owns the `wanwei-skill-marketplace` row in [its patch](../../bundle/wanwei-desktop/cordis.patch.yml). Product installations must configure the OneAPI Host and native bridge; this package does not ask a user to enter a provider secret in the browser.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client reads the published skill catalog from product remotes. A skill installation refreshes the official browser skill catalog. OneAPI authentication supplies account-scoped remotes; the market does not register another business page.

SkillHub returns can contain repeated slugs. Card identity includes the row position so replacing a page removes every old row, including repeated entries; rendering is bounded to twelve cards. Market and installation grids have separate identities so remote catalog cards cannot survive a switch to local installations. Page-jump inputs share compact rounded styling across catalogs. Selecting a card immediately opens details from its list data, then refreshes remote fields without inserting a loading hint into the list. Installation and updates wait for those fields; returning discards late responses.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Product composition](../../bundle/wanwei-desktop/README.md) — which private plugins the desktop mounts.
- [Expert library](../expert-library/README.md) — independent website workbenches.

-----

<a id="model-experience"></a>
## Model Experience

### Skill invocation draft

#### What the model sees

Selecting “Use skill” only stages a slash token such as `/office-meeting-minutes` in the pre-Session draft. The model sees that text only if the user sends the prompt; presentation of the skill name does not alter the submitted text.

#### Token effect

Opening the draft consumes no model tokens. A sent prompt uses the standard DSH model request and its ordinary token accounting.

#### KV Cache effect

No cache changes occur before sending. After send, normal prompt changes may affect cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Published skills and upload-review state depend on a reachable OneAPI service.
- SkillHub browsing needs actual upstream connectivity in either deployment mode. Failed catalog requests show a large retryable placeholder; installed SkillHub skills remain locally usable without the catalog. A skill's own remote dependencies can still fail.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
