---
description: "Configure Chinese-first conversation policy and Chinese interface dictionaries for Wanwei desktop."
kind: "package-reference"
---

# Wanwei Chinese conversation plugin

English | [中文](README.zh.md)

## Summary

The private desktop bundle mounts `@deepseek-ai/dsh-wanwei-chinese`. Its Host contributes one language-policy section through `systemPrompt.section()`. Its Client registers `zh-CN`, falling back to the official `zh` dictionaries, and supplies conversation-only interaction translations. It does not translate historical messages, tool results, code, paths, command ids or permission values.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

`instruction` contains the configurable Chinese-first policy, including an exception for explicit user language requests. The Client selects the Chinese pack at load; users can subsequently change the interface language in General settings. Removing or disabling the `wanwei-chinese` Loader entry disposes the prompt section and dictionaries. The Client restores its preceding selection only while its own language remains selected; it never overwrites a subsequent user selection. The official client graph does not project Host configuration, so the Loader entry is the single enable/disable control for both faces.

The product-owned profile can opt out with this `cordis.patch.yml` row:

```yaml
- id: wanwei-chinese
  disabled: true
```

<a id="model-experience"></a>
## Model Experience

### Chinese-first conversation policy

#### What the model sees

**Model-visible effect:** the `wanwei:conversation-language` policy section requests Simplified Chinese throughout each turn, including candidate-file confirmations, clarification questions and option labels, progress, summaries and natural-language tool arguments. English skill instructions, file contents and earlier messages do not imply an English language request. Explicit user language requests still take precedence; machine identifiers, filenames, paths and raw tool results remain unchanged. The section follows tool guidance and precedes structured-output instructions. Expert personas and tool schemas are unchanged. The official prompt assembly records the contributed text through its normal request logging.

#### Token effect

One short constant section adds prompt tokens while enabled. Interface translations do not add model calls or tokens.

#### KV Cache effect

Switching or disabling the policy changes the prompt prefix and may reduce prefix-cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Complete personas intentionally exclude additional system sections under the official assembly rules. This plugin does not override that protection or guarantee model compliance or internal reasoning language. A deployment's explicit `instruction` replaces the default policy. Historical messages are not rewritten. Unknown provider labels and command descriptions remain verbatim. Market content and broad application localization are outside this package.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
