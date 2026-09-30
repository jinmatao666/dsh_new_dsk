---
description: "Use the Wanwei desktop skill market and published expert websites while the official DSH skill runtime remains responsible for skill execution."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-skill-marketplace

English | [中文](README.zh.md)

## Summary

The Wanwei desktop can browse published skills, manage its local installations and review personal uploads through this plugin. It can also discover any published independent expert website from OneAPI and open its workbench in a main-window Tab. The plugin does not own an expert's task history or result files; each website stores those records.

Published expert cards use administrator-configured names, subtitles, summaries, tags, and uploaded images. The detail dialog uses the same image plus the configured detail panels and footer note; older records without panels retain their fallback presentation.

Expert cards contain uploaded images within a 42-pixel square inside a 48-pixel avatar, preserving the complete artwork and reserving title space beside it.

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

Use the Wanwei product profile when the desktop needs the OneAPI-backed catalog and local skill installation. Official DSH skill packages still discover and run installed skills. An independent expert requires a published catalog entry, a working identity endpoint and an approved HTTPS website.

The market contains official-platform-only recommendations, all published platform skills and a separate SkillHub section. Each catalog owns its Enter-submitted search, category, sort and twelve-card pagination in a compact toolbar; platform search hides recommendations and does not filter SkillHub. Popular sorting uses download counts; platform latest-update sorting requires backend timestamps and keeps undated entries in server order after dated entries. SkillHub cards share the platform download glyph without a repeated source badge, and details open at page level while preserving list position. My installations includes local SkillHub receipts and supports offline use, removal and manual updates. [The SkillHub adapter](../skillhub/README.md) owns upstream requests and limits.

Platform and SkillHub toolbars show nearby page numbers, the first and last page, and a bounded page-number jump. Paging, search and filters preserve the market panel's scroll position. SkillHub keeps the previous cards visible while the requested page loads so the panel does not collapse between requests.

Catalog and installation filters share the rounded dropdown control with desktop settings fields. The list is positioned above or below its trigger according to available space, without the operating system's square native popup.

Platform category choices come exclusively from backend category management. The client does not insert a fixed generic category; administrator-configured categories remain available under their actual names.

Dragging either column-width handle preserves the active skill market, expert, connector or automation panel and its local state. Selecting a sidebar navigation action still leaves the panel; changing layout geometry does not select a conversation.

My installations combines platform/local skills and SkillHub receipts into one twelve-card list. Matching cross-source installations appear as one card in the combined view; the source selector still exposes each installation separately. Its toolbar contains Enter-submitted search, a single source selector and pagination; filtering resets to page one, and removal clamps the page to the remaining results. Native skill-catalog changes refresh platform installation states alongside SkillHub receipts, so removal does not leave a stale installed card. Cards open skill details; removal and updates are available there instead of on the cards. This view reads local receipts without requesting the upstream catalog.

### Composition

The expert library uses a single in-page tab row: the fixed Experts catalog tab is followed by independently closable expert workbenches. Multiple experts remain mounted while switching; reopening the same expert focuses its existing tab without requesting another launch ticket. Closing the active tab selects a neighboring expert or returns to the catalog, and logout disposes all workbenches. The row scrolls horizontally when needed.

The personal-skill import dialog presents visibility and skill source as peer fieldsets. Directory and ZIP controls share compact button styling; the selected path occupies a separate full-width row, with overflow truncation and a full-path tooltip. Header-only styles do not apply to source controls, and short windows use tighter spacing.

Platform and SkillHub operations share restrained, top-centered notices. SkillHub progress remains visible until completion; installation, update and removal results appear as soon as the native operation succeeds, before refreshing local receipts. A failed refresh reports that the operation completed but the list could not refresh.

Starting an installed skill stages its slash token and friendly name. The composer displays a compact inline skill chip beside the editable question; Session-backed chips serialize to the same slash token. Product styling remains in the Wanwei UI packages.

The product bundle owns the `wanwei-skill-marketplace` row in [its patch](../../bundle/wanwei-desktop/cordis.patch.yml). Product installations must configure the OneAPI Host and native bridge; this package does not ask a user to enter a provider secret in the browser.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client reads the published skill and expert catalogs from product remotes. Expert IDs must match the launch interface: 3–80 lowercase ASCII letters, digits or hyphens, beginning with a letter. Invalid entries are omitted. A skill installation refreshes the official browser skill catalog. A selected expert obtains a one-use launch ticket from the Host, then opens an origin-limited native child Webview inside the main-window Tab. A separate modal hides the native view until the modal closes. The expert website owns its own tasks and results.

SkillHub returns can contain repeated slugs. Card identity includes the row position so replacing a page removes every old row, including repeated entries; rendering is bounded to twelve cards. Market and installation grids have separate identities so remote catalog cards cannot survive a switch to local installations. Page-jump inputs share compact rounded styling across catalogs. Selecting a card immediately opens details from its list data, then refreshes remote fields without inserting a loading hint into the list. Installation and updates wait for those fields; returning discards late responses.

Equivalent launch values and presentation callback changes preserve the native website session. Changing the expert ID, URL or ticket replaces the view; closing a Tab suppresses late visibility and bounds errors.

The catalog owns each pending launch. Logout or component disposal invalidates it, so a late success cannot reopen a website and a late failure cannot replace the current notice. A pending launch cannot be submitted twice.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Product composition](../../bundle/wanwei-desktop/README.md) — which private plugins the desktop mounts.
- [Expert website plan](../../../WANWEI_EXPERT_WEB_INTEGRATION_PLAN.md) — delivery and acceptance scope.

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

- Published skills, upload-review state and expert discovery depend on a reachable OneAPI service.
- Expert website Tabs require the Wanwei desktop native bridge. Their container, privileges and download behavior still need Windows, both macOS architectures and Linux acceptance.
- A website's task records and artifacts stay in that website, not in the skill market or the platform conversation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
