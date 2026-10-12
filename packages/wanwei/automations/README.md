---
description: "Display the independent Wanwei automation page without starting a scheduler."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-automations

English | [中文](README.zh.md)

## Summary

Users can browse the existing task templates, history and creation demonstrations in Internet mode. In intranet mode, the entry is disabled and its page cannot open, matching the expert library. System Settings controls entry visibility independently for Internet and intranet deployments; both default to visible, but visibility does not override intranet unavailability. Desktop startup or login refresh applies the setting. Mounting it does not require the skills marketplace, expert library or connectors plugin.

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

The desktop shows task cards with enabled/paused filters, editing and batch actions. Changes stay in the mounted page and reset when it closes; the history tab has no real records. Opening this page does not schedule tasks or call models.

Disable this plugin's row to remove its entry; do not disable another business plugin as a substitute. Shared authentication, renderer and sidebar services remain provider-owned.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client owns template tabs, selections and notices. It uses feature-panels only for presentation and navigation. Its instance controller closes on sidebar navigation or logout and detaches listeners on disposal.

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

- Durable task configuration, scheduling and real execution history are not implemented by this page.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
