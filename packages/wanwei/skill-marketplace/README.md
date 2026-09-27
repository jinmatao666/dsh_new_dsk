---
description: "Use the Wanwei desktop skill market and published expert websites while the official DSH skill runtime remains responsible for skill execution."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-skill-marketplace

English | [中文](README.zh.md)

## Summary

The Wanwei desktop can browse published skills, manage its local installations and review personal uploads through this plugin. It can also discover any published independent expert website from OneAPI and open its workbench in a main-window Tab. The plugin does not own an expert's task history or result files; each website stores those records.

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

Use the Wanwei product profile when the desktop needs the OneAPI-backed catalog and local skill installation. Official DSH skill packages still discover and run installed skills. An independent expert requires a published catalog entry, a working identity endpoint and an approved HTTPS website.

The market contains platform-only recommendations, platform skills and a separate SkillHub section. SkillHub search, categories and pagination are independent of platform filters. My installations includes local SkillHub receipts and supports offline use and removal. [The SkillHub adapter](../skillhub/README.md) owns upstream requests and limits.

### Composition

The product bundle owns the `wanwei-skill-marketplace` row in [its patch](../../bundle/wanwei-desktop/cordis.patch.yml). Product installations must configure the OneAPI Host and native bridge; this package does not ask a user to enter a provider secret in the browser.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client reads the published skill and expert catalogs from product remotes. Expert IDs must match the launch interface: 3–80 lowercase ASCII letters, digits or hyphens, beginning with a letter. Invalid entries are omitted. A skill installation refreshes the official browser skill catalog. A selected expert obtains a one-use launch ticket from the Host, then opens an origin-limited native child Webview inside the main-window Tab. A separate modal hides the native view until the modal closes. The expert website owns its own tasks and results.

Equivalent launch values and presentation callback changes preserve the native website session. Changing the expert ID, URL or ticket replaces the view; closing a Tab suppresses late visibility and bounds errors.

The catalog owns each pending launch. Logout or component disposal invalidates it, so a late success cannot reopen a website and a late failure cannot replace the current notice. A pending launch cannot be submitted twice.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Product composition](../../bundle/wanwei-desktop/README.md) — which private plugins the desktop mounts.
- [Expert website plan](../../../WANWEI_EXPERT_WEB_INTEGRATION_PLAN.md) — delivery and acceptance scope.

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

- Published skills, upload-review state and expert discovery depend on a reachable OneAPI service.
- Expert website Tabs require the Wanwei desktop native bridge. Their container, privileges and download behavior still need Windows, both macOS architectures and Linux acceptance.
- A website's task records and artifacts stay in that website, not in the skill market or the platform conversation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
