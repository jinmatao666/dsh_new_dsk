---
description: "Reuse Wanwei page chrome, transient notices and instance-owned navigation across independent feature plugins."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-feature-panels

English | [中文](README.zh.md)

## Summary

Product plugins can share the sidebar and overlay appearance without sharing catalogs or business state. Each caller allocates its own controller with its mounting Context. Opening one page closes another visible page through a local browser event, while disposal affects only the owning instance.

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

Entry visibility is administrator-owned, not inferred from the network-mode label. The shared `ServiceUnavailable` component accepts localized copy and a service-specific illustration variant; consumers show it only after their actual service request fails. Bundled cloud-skill, expert-card and disconnected-plug illustrations need no network access. The placeholder has no retry button or raw diagnostic text.

The Wanwei desktop product mounts this plugin through its [composition patch](../../bundle/wanwei-desktop/cordis.patch.yml). It has no per-plugin configuration fields.

Features with `requiresDirectInternet` retain a disabled sidebar entry in intranet mode until the Host confirms a successful direct probe. Their tooltip reads “当前网络环境不可达，请检查您的网络”. An unavailable page stays closed even when opened through another entry point. Administrator visibility remains independent and can still hide an entry.

Keep this shared provider mounted when a feature imports its Client exports. It has no feature entries of its own and contains no expert, skill, connector or automation data.

Consumers import the helpers from `@deepseek-ai/dsh-wanwei-feature-panels/client`. Keep this provider enabled while any consumer is mounted; disabling a business feature removes only that feature's entry. Shared authentication, renderer and sidebar services remain provider-owned.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client exports panel controllers, registration helpers, page chrome, notices and interaction classification. The caller supplies the title, icon, content and optional visibility observable. A hidden entry renders no placeholder and closes its page; the sidebar keeps Settings anchored below the remaining actions. Controller listeners belong to the caller's Context; callback failures are contained, logout closes open pages, and disposal closes the page and removes listeners. Resizing and owned dropdown interactions preserve the active page.

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

- Consumers must declare the Client module in dsh.client.external and mount this provider. This package is presentation infrastructure, not a fifth business feature.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
