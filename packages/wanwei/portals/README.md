---
description: "Show administrator-configured land-market and policy-encyclopedia pages as independent desktop feature panels."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-portals

English | [中文](README.zh.md)

## Summary

This plugin mounts two independent feature entries: land market and policy encyclopedia. Each entry’s visibility follows the current deployment environment flags from OneAPI. When open, the panel embeds the administrator-configured page URL edge-to-edge (no feature-panel title stack; only the top-right back control remains) and maximizes the desktop window. While the iframe loads, it shows the same centered spinner used by knowledge-base document viewers. Missing URLs show a configuration placeholder instead of an empty frame.

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

Administrators set entry visibility and page URLs under workbench System Settings → Feature Settings (use Address Configuration beside land market and policy encyclopedia). Disable this plugin’s row to remove both entries.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

Visibility and URLs come from `/api/desktop-config` through `wanweiNetwork`. Opening a panel closes the sidebar and invokes the existing `maximize_expert_window` native command. Registration sets `headerChrome: 'back-only'` so the shared panel omits the WANWEI Buddy / title / subtitle stack and keeps only a floating back control. Content uses an iframe so any http(s) address configured by the administrator can render without an expert ticket. `PortalPage` keeps the iframe mounted under a full-panel loading overlay until the frame’s `load` event fires, and restores the overlay when the configured URL changes.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Feature panels](../feature-panels/README.md)
- [OneAPI authentication](../oneapi-auth/README.md)

-----

<a id="model-experience"></a>
## Model Experience

This package registers no model-facing prompts, tools, or session events.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Sites that refuse iframe embedding remain blank; this package does not open a native child webview or external browser for those pages.
- Maximizing reuses the expert-window native command; older desktop builds without that command keep the current window size.

-----

<a id="dev-note"></a>
## Dev Note

Focused Client coverage lives in `tests/portals.client.spec.tsx`.
