---
description: "Browse platform and SkillHub skills, manage local installations and stage skill invocations."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-skill-marketplace

English | [中文](README.zh.md)

## Summary

This plugin presents recommendations, platform skills and SkillHub skills as three sibling sections, and manages local installations and personal uploads.

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

The Wanwei desktop bundle mounts this Client plugin after the official browser UI; it is not a standalone application.

### When to choose it

Use the Wanwei product profile for platform catalogs and local skill installation. Official DSH packages discover and run installed skills.

The market contains platform-only recommendations, platform skills and a separate SkillHub section. SkillHub search, categories and pagination are independent of platform filters. My installations includes local SkillHub receipts and supports offline use and removal. [The SkillHub adapter](../skillhub/README.md) owns upstream requests and limits.

### Composition

The product bundle owns the `wanwei-skill-marketplace` row in [its patch](../../bundle/wanwei-desktop/cordis.patch.yml). Product installations must configure the OneAPI Host and native bridge; this package does not ask a user to enter a provider secret in the browser.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The product Client reads platform and SkillHub catalogs; the native bridge records installation sources. Using a skill stages its actual local name in an editable conversation draft, without submitting it.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Product composition](../../bundle/wanwei-desktop/README.md) — which private plugins the desktop mounts.

-----

<a id="model-experience"></a>
## Model Experience

### Skill invocation draft

#### What the model sees

Selecting “Use skill” only stages a slash token such as `/office-meeting-minutes` in the pre-Session draft. The model sees that text only if the user sends the prompt; presentation of the skill name does not alter the submitted text.

#### Token effect

Opening the draft consumes no model tokens. A sent prompt uses the standard DSH model request and its ordinary token accounting.

#### KV Cache effect

No cache changes occur before sending. After send, normal prompt changes may affect cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Platform catalogs and upload reviews require OneAPI; SkillHub catalogs require its public API.
- Native installation requires the Wanwei desktop; users configure additional skill runtime dependencies.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
