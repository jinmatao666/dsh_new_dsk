---
description: "Private Wanwei desktop product layer that composes customer-owned plugins over the official dsh browser application."
kind: "package-bundle"
---

# `@deepseek-ai/dsh-wanwei-desktop`

English | [中文](README.zh.md)

## Summary

The `wanwei-desktop` profile uses this private bundle as the final product-owned layer over [`dsh-base`](../base/README.md) and [`dsh-web-app`](../web-app/README.md). The layer is the single composition point for Wanwei authentication, model governance, skills, desktop integration, and presentation packages. Its patch is intentionally empty until those feature packages are ported, so the first composition retains the official browser behavior.

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

The first command initializes the profile and prints its effective default tree without booting it. The second command starts the browser application with live profile-patch reload.

### What you get

The current layer reserves a Wanwei-owned patch position after the official Web application and changes no runtime row. Later Wanwei feature packages enter through this patch instead of modifying the official base or Web bundles.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`cordis.patch.yml`](cordis.patch.yml) is the product-owned layer and currently contains an empty patch list. [`src/index.ts`](src/index.ts) anchors the bundle package, while [`src/invariant.ts`](src/invariant.ts) reserves its package-owned invariant registration without duplicating the runtime checks of future feature packages.

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

Nothing from this package. The empty `cordis.patch.yml` adds no prompt, tool, message, or result; the official base and Web bundles continue to own them.

#### Token effect

Zero direct tokens while the product patch remains empty. Each future inserted package owns and documents its own token effect.

#### KV Cache effect

This empty layer preserves the official composition's cache behavior. A future patch entry can affect reuse only through the package that owns that entry.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No private feature is mounted yet** — the profile currently proves the isolated product-layer boundary and behaves like the official Web composition.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
