# Agent Note: Model capability probe

Status: implemented

English | [中文](2026-09-15-model-capability-probe.zh.md)

## Problem

The administrator model page identified image input with one fixed red image and accepted any response containing `red`. A text-only model could ignore the image, guess the color, and remain advertised to desktop clients as image-capable. Later inconclusive probes also preserved that stale result.

## Decision

Capability detection sends three solid images with distinct expected colors to every enabled source channel. Each response must contain exactly the requested color word after insignificant surrounding punctuation is removed. A model is stored as multimodal only when every enabled source passes every probe.

An explicit image-input rejection or an incorrect color response stores the model as text-only. Transport and channel failures are inconclusive: they report an error and preserve the previous capability instead of changing it. The administrator list presents this stored result as `文本模型` or `多模态模型`; it does not repeat the capability below the model name or inside the edit form.

## Alternatives considered

**Keep one fixed image and tighten response matching.** Exact matching rejects explanatory hallucinations but a text-only model can still guess one known color.

**Infer capability from model names.** Provider aliases and private deployments make naming conventions incomplete and unsafe for desktop image admission.

## Consequences

Image support is conservative and consistent across all routes that may serve a model. Detection costs three small requests per enabled source. Administrators must retry after transient channel failures because inconclusive probes do not overwrite stored capability.
