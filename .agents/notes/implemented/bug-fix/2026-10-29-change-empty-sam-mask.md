# Agent Note: Preserve usable change results when SAM3 returns no mask

Status: implemented

English | [中文](2026-10-29-change-empty-sam-mask.zh.md)

## Problem

A production replay returned mask counts 1, 0, 1 for three new-change events. The worker aborted all results at the second event.

## Decision

Retry empty masks once on a contextual crop, with a known English category where available and unchanged confidence. Record attempt counts and coordinates. Preserve unresolved events as localization only alongside confirmed masks, with explicit partial-area labels and no fabricated mask. Both temporal masks remain necessary for geometric change subtraction. Service and protocol errors still fail explicitly.

## Alternatives considered

Failing the whole task loses valid results. Replacing empty masks with rectangles invents measured area. Treating a missing earlier mask as an empty object invents temporal evidence.

## Consequences

An empty response can add one inference call per phase. Partial results retain uncertainty in JSON, CSV and the workbench. Entirely unresolved results have no mask artifact or area statistic. This repair does not establish whether a particular semantic change is correct.

## Testing

Focused Python regressions cover crop-coordinate mapping, unchanged confidence, partial and entirely empty results, and protocol-error propagation. JavaScript syntax and browser fixtures check partial-result labels. Real SAM3 recovery for the reported event requires deployment and a replay on the GPU host.
