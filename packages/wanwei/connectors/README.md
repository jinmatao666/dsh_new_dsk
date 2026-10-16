---
description: "Display the independent Wanwei connector page with server-controlled entry visibility."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-connectors

English | [中文](README.zh.md)

## Summary

Users can browse connector categories and inspect the existing demonstration dialogs. System Settings controls its entry independently for Internet and intranet deployments; the default enables Internet and hides intranet. Desktop startup or login refresh applies the setting. Mounting it does not require the skills marketplace, expert library or automations plugin.

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

The existing connector data and interactions are demonstrations. Dialog actions do not authorize a real service or persist credentials.

Opening the page checks the configured platform through the deployment refresh RPC in either network mode. A failed request shows a disconnected-plug placeholder; a successful check displays the local demonstration directory. Reopening the page checks again. This checks platform reachability, not third-party connector health or authorization. Administrator entry visibility still applies.

Disable this plugin's row to remove its entry; do not disable another business plugin as a substitute. Shared authentication, renderer and sidebar services remain provider-owned.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client owns its connector list, selection and dialogs. It imports shared presentation from feature-panels and the rounded Select primitive. Its instance controller closes on sidebar navigation or logout and detaches listeners on disposal.

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

- Real authorization, durable credentials and service execution are not implemented by this page.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
