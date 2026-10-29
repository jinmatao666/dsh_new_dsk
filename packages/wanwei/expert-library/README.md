---
description: "Browse published experts and open independent native workbenches without mounting the skills marketplace."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-expert-library

English | [中文](README.zh.md)

## Summary

Refresh catalog reloads published cards and category positions without restarting the desktop or closing running workbenches. Card order and category-navigation order remain independent administrator settings.

Card order follows the backend catalog; category navigation independently follows administrator-defined category positions. Published metadata retains each expert’s internet requirement flag. In intranet mode without confirmed connectivity, marked cards follow the administrator’s hide/disable choice; disabled cards show the network-unreachable tooltip and cannot open details or start a new workbench. Connectivity refresh restores them. Already running workbenches remain open.

Users can inspect administrator-authored expert descriptions and open several workbenches in one tab row. Reopening an expert focuses its existing tab without obtaining another ticket. This page requires OneAPI and the desktop native bridge. Both deployment modes attempt the configured service; a failed catalog request shows an expert-card placeholder instead of disabled navigation or an empty catalog. Reopening the page loads the catalog again.

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

The Wanwei desktop product mounts this plugin through its [composition patch](../../bundle/wanwei-desktop/cordis.patch.yml). It has no per-plugin configuration fields.

Published cards use configured names, subtitles, summaries, tags and uploaded images. Images occupy a 42-pixel square inside a 48-pixel avatar. Details use the configured panels and footer note, with fallback presentation for older records.

Disable this plugin's row to remove its entry; do not disable another business plugin as a substitute. Shared authentication, renderer and sidebar services remain provider-owned.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Expert IDs accept 3–80 lowercase ASCII letters, digits or hyphens, beginning with a letter. The instance owns catalog loading and pending launches. Logout or unmount invalidates late responses; pending launches cannot be submitted twice. Native views stay mounted while changing tabs, hide beneath dialogs, and dispose when their tabs close. Equivalent launch values preserve a website session; changing ID, URL or ticket replaces it.

The active workbench fills the remaining panel height through the body and expert container's flex layout. The native view waits for valid bounds; catalog mode retains ordinary scrolling. The [layout regression](tests/workbench-composition.mjs) boots the desktop profile and checks real browser geometry without mocking element sizes.

Native operations run serially: creation returns a hidden child, bounds are applied before showing, and disposal waits for outstanding operations before hiding and closing. Visibility is recorded only after native acknowledgement. A bridge failure removes the affected tab and shows its error in the catalog; close retries once. The desktop restores main-view focus after hiding or closing and records lifecycle events in `logs/expert-webviews.log` under its local application data directory without URLs or tickets.

The [Client entry](src/client/index.ts) supplies the implementation. The [Host entry](src/index.ts) anchors module discovery without registering a business service.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Product composition](../../bundle/wanwei-desktop/README.md) — profile ownership.
- [Authentication and network policy](../oneapi-auth/README.md) — shared services.
- [Independent page decision](../../../.agents/notes/implemented/architecture/2026-10-10-independent-wanwei-pages.md) — lifecycle and dependency rationale.

-----

<a id="model-experience"></a>
## Model Experience

None, as this Client presentation registers no prompt or tools; website execution and Host model providers own downstream requests and token use.

#### KV Cache effect

No direct changes to model context or cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Native Webview geometry, privileges and downloads still require Windows, macOS and UOS acceptance. Expert task records and artifacts remain website-owned.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

Catalog access decisions cross plugin boundaries through the injected `wanweiNetwork.catalogAccess` service method. Client entrypoints expose network types only; consumers do not import the authentication plugin's runtime helpers.

Internet-dependent skill and expert presentation is configured independently with `internetSkillPolicy` and `internetExpertPolicy`. Missing values inherit the legacy shared policy; updated desktop clients are required to apply the independent choices.
