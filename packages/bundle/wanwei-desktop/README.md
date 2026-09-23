---
description: "Private Wanwei desktop product layer that composes customer-owned plugins over the official dsh browser application."
kind: "package-bundle"
---

# `@deepseek-ai/dsh-wanwei-desktop`

English | [中文](README.zh.md)

## Summary

The `wanwei-desktop` profile uses this private bundle as the final product-owned layer over [`dsh-base`](../base/README.md) and [`dsh-web-app`](../web-app/README.md). The layer composes Wanwei authentication, model governance, skills, desktop integration, and presentation packages. It disables the official DeepSeek adapter and editable Models settings section so the desktop uses the OneAPI-managed catalog.

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

### Launch the product profile

The shipped `wanwei-desktop` template contains `dsh-base`, `dsh-web-app`, and this bundle in that order:

```sh
pnpm dsh --profile wanwei-desktop --dump-default-config
pnpm dsh --profile wanwei-desktop
```

The first command prints the effective default tree without booting it after the product profile has been initialized. The second command starts the browser application with live profile-patch reload.

### What you get

The layer disables `llm-deepseek` and `ui-settings-models`, then mounts the Wanwei-owned plugins. The OneAPI authentication plugin supplies the sole managed provider and a read-only Models settings section; it does not change the official base or Web bundles.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`cordis.patch.yml`](cordis.patch.yml) owns the product-specific composition. [`src/index.ts`](src/index.ts) anchors the bundle package, while [`src/invariant.ts`](src/invariant.ts) owns its invariant registration.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Bundle packages](../README.md) — profile-layer ownership and the official application bundles.
- [Application boot](../../boot/app-boot/README.md#profiles) — template initialization and layer ordering.
- [CLI profiles](../../../apps/cli/README.md#profiles) — launcher behavior and configuration dumps.

-----

<a id="model-experience"></a>
## Model Experience

### Composition only

#### What the model sees

This composition layer adds no prompt, tool, message, or result. Its mounted packages own their model-visible behavior.

#### Token effect

Zero direct tokens from the composition layer. Each mounted package owns and documents its token effect.

#### KV Cache effect

The layer does not directly change cache behavior. Mounted packages document their own cache effects.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Server dependency** — model discovery requires the configured OneAPI service; the desktop does not offer local provider configuration as a fallback.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
