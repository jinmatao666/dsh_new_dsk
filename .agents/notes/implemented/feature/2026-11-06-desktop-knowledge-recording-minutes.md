# Agent Note: Desktop knowledge recording minutes

Status: implemented

English | [中文](2026-11-06-desktop-knowledge-recording-minutes.zh.md)

## Problem

Personal desktop libraries needed an in-app microphone capture path that produces a listable audio artifact and a dual-pane transcript / 速览 / 纪要 preview with playback, matching the product recording-minutes entry beside local files and web links. Browser-only Web Speech captions are unreliable on desktop Electron, so empty 逐字稿 and “未捕获实时转写” placeholders appeared after save.

## Decision

The personal upload menu opens a floating `RecordingPanel` that records through `MediaRecorder` (max 20 minutes), converts the blob to mono 16 kHz WAV in the Client, and posts it to Host `/api/desktop-knowledge-recording-minutes`. The Host proxies OneAPI `/v1/audio/transcriptions` (config `knowledgeTranscriptionModel`) and optional `/v1/chat/completions` (`defaultModel`) to fill 逐字稿 / 速览 / 纪要, falls back to a local greeting heuristic when chat is unavailable, then uploads `录音纪要_….md` plus `录音纪要_….wav`. OneAPI skips RAGFlow parse for audio extensions so WAV stays for playback without parse-fail status. Opening either sibling loads `MinutesViewer`. Live Web Speech text is only a fallback when ASR returns empty.

## Alternatives considered

**Markdown-only upload with browser Web Speech captions.** Rejected as the sole path after empty-transcript regressions on desktop; ASR must run on the Host where OneAPI models are configured.

**Embed the meeting-minutes expert website inside the knowledge page.** Rejected; expert sites must stay independently deployable and must not import into DSH Client packages.

**Upload audio only and rely on RAGFlow audio parse for all text.** Rejected; this deployment fails or leaves audio documents unusable for chunk text, so markdown is authored before upload and audio parse is skipped.

## Consequences

Recording-minutes shares the personal-only upload gate from [desktop knowledge upload personal-only](2026-11-06-desktop-knowledge-upload-personal-only.md). The floating recorder renders inside `.dsh-knowledge` so FeaturePanel outside-click navigation treats it as an in-panel interaction. Microphone permission is owned by the OS / desktop shell. Deployments must expose a working transcription model id via `knowledgeTranscriptionModel`. Focused Client and Host tests cover the menu entry, helper packaging, dual-pane open, greeting heuristic, and multipart field validation.
