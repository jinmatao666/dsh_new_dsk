---
description: "Product-owned local office-document extraction tool for the Wanwei desktop."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-document-local

English | [中文](README.zh.md)

## Summary

The desktop registers `extract_document` to extract text from local PDF, DOCX and XLSX files through its packaged Node helper. This product tool does not change official DSH document components.

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

Mount this package with the Wanwei desktop bundle and its `tools` service. `helperPath` and `nodeBinary` can point at a packaged helper and executable; `DSH_DOCUMENT_TOOL` and `DSH_NODE_BINARY` override them for a deployment. The ordinary default is the product script `products/wanwei-desktop/scripts/document-tool.mjs` and the current Node executable.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/index.ts`](src/index.ts) spawns the helper with a hidden console on Windows and reads its JSON response. A scanned PDF without extractable text returns `needs_vision`; other extraction failures return `unavailable`. The helper, not this package, implements the document formats.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Product document helper](../../../products/wanwei-desktop/scripts/document-tool.mjs) — extraction implementation.
- [Wanwei bundle](../../bundle/wanwei-desktop/README.md) — product composition.

-----

<a id="model-experience"></a>
## Model Experience

### Local document extraction

#### What the model sees

The `extract_document` tool result renders a `<document>` block with status, path, message, extracted text and warnings. A `needs_vision` result explicitly forbids inventing scanned content.

#### Token effect

The helper makes no model call. Extracted text returned to the agent consumes context tokens in subsequent model turns; the optional `max_chars` caps its length.

#### KV Cache effect

Different extracted text changes subsequent prompt content and may invalidate downstream cache reuse. The package has no independent cache.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Text extraction only** — scanned PDFs need a configured vision/OCR capability; extraction alone does not verify document meaning or layout.
- **Packaged helper required** — an absent helper path fails the tool call rather than silently installing dependencies.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep local document behavior in this product package and its product helper, not official DSH UI packages.

</details>
