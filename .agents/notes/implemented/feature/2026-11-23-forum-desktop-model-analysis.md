# Agent Note: Planning lecture uses the desktop model selector

Status: implemented

English | [中文](2026-11-23-forum-desktop-model-analysis.zh.md)

## Problem

The embedded planning lecture needs article analysis using the model selected in the desktop. Its login ticket identifies the user but does not grant model access. A per-session model choice can differ from the global default.

## Decision

The [portal Client](../../../../packages/wanwei/portals/src/client/plugin.tsx) reads the current session's model directory, or the draft directory before a session exists, for each question. Only the parent desktop supplies the model selection to the authenticated Host stream. The embedded page supplies article text, a question and completed history through a bridge that checks both origin and iframe identity. Credentials remain in the Host.

For each uncached question, the Host creates a fresh agent with a complete analysis prompt, no ambient prompt contexts and no tools. Normal session events preserve the complete input, request header and answer. Input limits reject excess data without silent truncation. Cancellation and disposal stop and drain the owned agent before releasing request capacity. The forum displays completed answers and identifies the model used for the last answer. [Forum billing](2026-11-23-forum-analysis-billing.md) owns configured fees and persistent answer reuse.

## Alternatives considered

**Configure a shared model API key in the forum backend.** This requires separate authorization and accounting, and cannot follow a desktop session's selected model.

**Read only the global desktop default.** Desktop session and draft selectors can hold explicit choices without changing that default. The parent selector supplies the effective selection instead.

**Use the desktop's general-purpose agent directly.** An article is untrusted reference material; sharing a tool-enabled conversation would expose unrelated context and tool capabilities. Separate tool-free sessions preserve logging without that authority.

## Consequences

The updated desktop and forum frontend must ship together. Standalone forum browsing has no analysis bridge. Long documents or histories require a narrower request or cleared conversation; the feature does not retrieve missing external article text. Provider availability and account model permissions still govern inference.

## Verification

The package's Loader composition exercises model selection, logged inputs, tool exclusion, bounds, cancellation and timeout. Bridge tests reject another origin or iframe and suppress late results. The Web recorded-session scenario pins the analysis prompt and round trip through authenticated Host stream.
