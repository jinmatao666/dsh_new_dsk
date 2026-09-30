# Wanwei Chinese conversation plugin

English | [中文](README.zh.md)

The private desktop bundle mounts `@deepseek-ai/dsh-wanwei-chinese`. Its Host contributes one language-policy section through `systemPrompt.section()`. Its Client registers `zh-CN`, falling back to the official `zh` dictionaries, and supplies conversation-only interaction translations. It does not translate historical messages, tool results, code, paths, command ids or permission values.

## Configuration

`instruction` contains the configurable Chinese-first policy, including an exception for explicit user language requests. The Client selects the Chinese pack at load; users can subsequently change the interface language in General settings. Removing or disabling the `wanwei-chinese` Loader entry disposes the prompt section and dictionaries. The Client restores its preceding selection only while its own language remains selected; it never overwrites a subsequent user selection. The official client graph does not project Host configuration, so the Loader entry is the single enable/disable control for both faces.

The product-owned profile can opt out with this `cordis.patch.yml` row:

```yaml
- id: wanwei-chinese
  disabled: true
```

## Model Experience

**Model-visible effect:** the language policy requests Simplified Chinese answers, plans, progress, summaries and natural-language tool arguments while preserving machine identifiers and explicit language requests. Expert personas and tool schemas are unchanged. The official prompt assembly records the contributed text through its normal request logging.

**Token and KV-cache effect:** one short constant section adds prompt tokens while enabled. Switching or disabling the policy changes the prompt prefix and may reduce prefix-cache reuse. Interface translations do not add model calls or tokens.

## Known Limitations and Deferred Work

Complete personas intentionally exclude additional system sections under the official assembly rules. This plugin does not override that protection or guarantee a model's internal reasoning language. Unknown provider labels and command descriptions remain verbatim. Market content and broad application localization are outside this package.
