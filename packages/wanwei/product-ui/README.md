---
description: "Wanwei-owned desktop brand, theme, file-import and deliverable presentation layer."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-product-ui

English | [中文](README.zh.md)

## Summary

This client plugin owns Wanwei branding, theme overrides, desktop file-import affordances and spatial-analysis deliverable presentation. It registers through generic DSH slots and services rather than placing product behavior in official UI packages.

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

Mount it through the Wanwei desktop bundle after the client platform-action registry and official conversation, deliverable, renderer and sidebar plugins. The product theme loads from `src/client/theme.css`; the generic official DSH web application does not mount it.

-----

Brand occupants register at priority -100 so the product can coexist with the official brand plugin at its default priority.

Picker imports and native drops append file or folder chips through `inputActions.appendReferences`; the labels show filenames while serialization retains path mentions. Imports preserve existing text and references.

The native drag invitation covers only the composer card. Folder chips use a folder icon without a display-only trailing slash; their serialized references retain the slash. When a same-named destination already exists, desktop import copies into a numbered sibling, and the chip shows that actual destination name.

Session archive saving waits for native persistence, then requests the file manager to reveal the actual saved path. A reveal failure retains the saved path and returns a warning rather than reporting a failed download.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/client/product.tsx`](src/client/product.tsx) supplies brand-mark slots, file-import actions and product-specific deliverable parsing. [`src/client/AnalysisResultCard.tsx`](src/client/AnalysisResultCard.tsx) renders a spatial-analysis result. Native file operations require the product desktop bridge and are not implemented by the generic platform-action service.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Product bundle](../../bundle/wanwei-desktop/README.md) — composition order.
- [Generic platform actions](../../client/platform-actions/README.md) — shell-owned operation contract.

-----

<a id="model-experience"></a>
## Model Experience

### Product presentation

#### What the model sees

The `WANWEI_RESULT=` marker is parsed for UI deliverable presentation; rendering does not add a separate model message. Imported file paths entered through the conversation input become part of the user's subsequent request.

#### Token effect

Branding and result-card rendering consume no model tokens. A user's subsequent request mentioning an imported file follows ordinary DSH token accounting.

#### KV Cache effect

Pure UI presentation does not alter cache keys. A changed user request after importing a file can change the prompt and its downstream cache behavior.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Desktop bridge dependency** — file import and result-file actions need the Wanwei native shell; browser-only DSH cannot perform them.
- **Result protocol ownership** — `WANWEI_RESULT=` is a Wanwei product marker, not an official DSH document format.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep product selectors and marker parsing here; official UI packages may only expose generic slots or services.

</details>
