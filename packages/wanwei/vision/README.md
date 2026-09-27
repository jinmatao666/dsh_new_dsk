---
description: "OneAPI-governed local image recognition tool for the Wanwei desktop."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-vision

English | [中文](README.zh.md)

## Summary

The `recognize_image` tool reads a local image and asks the administrator-selected OneAPI vision model for a textual description. The upstream model key stays on OneAPI; the desktop uses its signed-in user token.

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

Mount it through the Wanwei desktop bundle with `tools`, `fs` and `credentials` services. An explicit `baseURL` overrides `DSH_ONEAPI_URL` from the launch environment, which falls back to `http://127.0.0.1:3000`; the origin excludes `/v1`. `credentialRef` defaults to `DSH_ONEAPI_TOKEN`. An administrator selects `vision_model` in OneAPI and authorizes that image-capable model for the user.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/index.ts`](src/index.ts) validates the file through DSH FS, limits it to 8 MiB and PNG/JPEG/WebP/GIF, checks server model selection and user access, then calls OneAPI chat completions. It returns a text description, including when the current chat model is text-only.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [OneAPI authentication](../oneapi-auth/README.md) — user token and managed models.
- [Wanwei bundle](../../bundle/wanwei-desktop/README.md) — product composition.

-----

<a id="model-experience"></a>
## Model Experience

### Image recognition

#### What the model sees

The `recognize_image` tool result contains `<path>`, `<vision_model>` and `<recognition>` text. The vision request uses the administrator-selected model, not necessarily the current chat model.

#### Token effect

The vision request incurs OneAPI model usage. Its returned description may also consume context tokens when the current chat model continues.

#### KV Cache effect

Different descriptions change subsequent chat prompt content and may reduce cache reuse. This package has no separate model cache.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Configured model required** — recognition fails if the administrator has not selected an image-capable model authorized to the user.
- **Format and size bounds** — only PNG/JPEG/WebP/GIF files up to 8 MiB are accepted; PDF scans use another workflow.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Do not copy upstream vision-provider keys into the desktop or official DSH packages.

</details>
