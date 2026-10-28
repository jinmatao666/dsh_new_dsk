# Agent Note: Partition client-module startup combos by body size and a 2 KiB URL ceiling

Status: implemented

English | [中文](2026-10-28-client-modules-combo-body-partition.zh.md)

## Problem

Packaged Wanwei desktop on Windows reported `Failed to load plugins` with
`client-modules: bundle script /plugins/??…&rev=… failed to load`. The application
phase had collapsed into one combo whose request-target was ~2.6 KiB and whose
executable body was ~7 MiB, dominated by `@deepseek-ai/dsh-wanwei-knowledge-base`
inlining `pdfjs-dist` plus its worker (~2.7 MiB). Chromium could still fetch and
parse that script; the packaged WebView path surfaced a script-element `error`
and aborted boot at the first loader entry sharing that URL.

## Decision

Keep URL-length partitioning, but lower the ceiling from 3 KiB to 2 KiB so
generated combo targets stay under the classic ~2083-byte request-target range
still hit by some Windows WebView stacks. Also partition when summed client-bundle
bytes would exceed 2 MiB; a single oversized body may still occupy its own chunk
because the route cannot split one file. Multiple application preloads and batch
URLs already exist in the boot protocol, so no client-loader change is required
beyond the partitioner.

## Alternatives considered

**Only shrink knowledge-base / lazy-load pdf.js.** Still needed for page weight,
but does not protect the next fat client from recreating a single multi-megabyte
startup script.

**Keep the 3 KiB URL ceiling.** The failing desktop combo already sat under 3 KiB
while exceeding the classic request-target range, so that ceiling alone cannot
catch this failure mode.

**Strip combo source maps in production.** Maps are separate immutable responses;
they do not drive the script-element `error` path observed here.

## Consequences

Wanwei desktop application plugins load as several smaller classic scripts instead
of one ~7 MiB combo. Installers built after this change must include the rebuilt
`@deepseek-ai/dsh-client-modules` node half. Knowledge-base can still produce a
solo combo above 2 MiB until pdf.js is moved off the critical client bundle; that
follow-up is independent.

## Testing

`packages/client/modules/tests/node-half.client.spec.ts` covers URL partitioning
at 2 KiB and body partitioning at 2 MiB, including that adjacent batches would
exceed the URL ceiling if merged.
