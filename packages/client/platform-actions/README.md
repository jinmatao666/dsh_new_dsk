---
description: "Optional browser-side operations provided by an embedding product shell."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-platform-actions

English | [中文](README.zh.md)

## Summary

This generic Cordis service lets a product shell register optional directory-opening and native file-saving operations without putting a specific desktop bridge in official DSH components.

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

Mount the client plugin before product-specific consumers. A product shell calls `ctx.platformActions.register({ openDirectory, saveFile })` and retains the returned disposer. Consumers check `canOpenDirectory()` or `canSaveFile()` before invoking an operation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/client/index.ts`](src/client/index.ts) owns one optional provider at a time. Calls without a registered operation reject with an unavailable error; disposal removes only the same provider instance. The service itself has no native implementation.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Client service tests](tests/service.client.spec.ts) — provider registration, invocation and disposal.

-----

<a id="model-experience"></a>
## Model Experience

### Platform actions

#### What the model sees

The `platformActions` registry does not itself create a model prompt, tool or result. A consuming plugin determines any model-visible behavior.

#### Token effect

Registration and direct UI invocation consume no model tokens.

#### KV Cache effect

The registry does not modify model messages or cache keys.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Optional provider** — operations are unavailable until a product shell registers them; the generic web application does not silently gain desktop filesystem access.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep product names, native bridge globals and platform-specific paths out of this package.

</details>
