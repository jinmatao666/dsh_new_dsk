# Agent Note: Route audio transcription by the requested model

Status: implemented

English | [中文](2026-09-17-one-api-audio-model-routing.zh.md)

## Problem

One API treated every multipart transcription and translation request as `whisper-1` during token authorization, role authorization, channel selection, billing, and channel model mapping. A caller-provided `model` field was therefore ignored before relay, and mapped audio requests still sent the unmapped model field to the upstream service.

The Ali Bailian `qwen-audio-3.0-asr-flash` service accepts native multimodal JSON rather than the OpenAI multipart transcription request used by the [meeting-minutes skill](../feature/2026-09-01-desktop-skill-install-and-dependency-grant.md). Passing its configured model name through the generic audio relay could select the right channel but could not satisfy the provider protocol.

## Decision

Reusable form binding passes the destination pointer directly to Gin, so multipart audio requests preserve their submitted `model`. Token and role authorization and channel distribution use that public model name. A missing audio model retains the compatible `whisper-1` default.

The audio controller uses the request model for billing and applies channel model mapping before relay. When a mapping changes the model, the controller rebuilds the multipart body with the mapped model while preserving the audio bytes, filename, headers, and other fields.

An `AliBailian` channel opts transcription into the provider's native multimodal endpoint. The controller converts the multipart audio into Base64 JSON, sends the channel credential to the native endpoint, and converts the provider's text result back to the requested OpenAI `json`, `verbose_json`, or `text` response. Other channel types continue to receive the OpenAI multipart request.

The meeting-minutes skill chooses its client protocol from the configured endpoint rather than the model name. A One API `/v1/audio/transcriptions` endpoint always receives multipart with the selected model field; only a direct Ali Bailian native generation endpoint receives Base64 JSON. This preserves direct-provider support without bypassing gateway routing when the deployment supplies a One API URL.

Channel and model connectivity tests inspect the registered model type. An `audio` model is probed with a generated one-second, 16 kHz mono PCM WAV through the configured transcription protocol instead of being sent to chat completions. The probe verifies routing, credentials, request conversion, and response parsing; it reports an empty transcription as a successful connection because the synthetic tone is not a speech-quality fixture. Chat model tests retain their existing request path.

## Alternatives considered

**Register `whisper-1` as an alias for every ASR model.** Rejected because authorization and channel selection would hide the caller's actual model, and the upstream multipart body would still contain an incompatible model and protocol.

**Make each skill call its provider directly.** Rejected as the only deployment path because credentials, provider selection, auditing, quotas, and model permissions belong to One API when a deployment chooses the gateway endpoint.

**Detect Ali Bailian from the model name or URL.** Rejected because names and deployment URLs are mutable. The existing explicit `AliBailian` channel type is the provider selection mechanism and leaves OpenAI-compatible channels unchanged.

## Consequences

ASR clients can select configured models through the same token, role, and channel policies as text requests. Existing requests that omit the model keep the `whisper-1` behavior, and OpenAI-compatible audio channels keep their multipart protocol. Native Ali Bailian transcription currently returns text-only response formats and assumes the normalized 16 kHz audio supplied by the meeting-minutes workflow; timestamped `srt` and `vtt` responses remain unsupported for that provider path.
