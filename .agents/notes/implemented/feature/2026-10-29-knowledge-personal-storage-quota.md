# Agent Note: Personal knowledge storage quota

Status: implemented

English | [中文](2026-10-29-knowledge-personal-storage-quota.zh.md)

## Problem

Administrators need to cap how much personal knowledge storage the whole deployment may hold, and optionally give named people their own ceilings. Without a workbench control and upload enforcement, personal libraries can grow without a product limit beyond the existing 20MB per-file cap.

## Decision

System settings gains a 知识库设置 tab with a 文件大小限制 switch (default off). When on, 设置 opens a dialog for the personal-library total (MB) and an organization tree that assigns optional per-person quotas. The policy lives in `SystemDeploymentSettings.knowledgeQuota` as `{ enabled, totalBytes, allocations: [{ userId, quotaBytes }] }`. Saving requires a positive total when enabled; the sum of allocations must not exceed the total. Upload and copy/move into a personal library call `enforcePersonalKnowledgeQuota`: with only a total, every personal library’s RAGFlow document bytes plus the new file must stay under the total; with a person allocation, that owner also cannot exceed their quota, and the global total still applies. Friendly Chinese messages name the limit. Shared and common libraries are unchanged. Desktop `GetDesktopConfig` clears `knowledgeQuota` so the pre-login surface does not publish admin policy. See also [personal knowledge directory by organization](2026-10-29-knowledge-personal-directory-by-organization.md).

## Alternatives considered

**Separate option key outside SystemDeploymentSettings:** rejected for this change so the existing root-only options load/save path and form dirty state stay one object; the field is omitted from the desktop config response.

**Track usage only in a local DB column:** deferred; current enforcement sums RAGFlow document sizes the same way plaza stats do, fail-closed when RAGFlow or listing is unavailable.

**Per-file size switch instead of total storage:** rejected because the requirement is total personal capacity and per-person share of that total; the 20MB single-file limit remains independent.

## Consequences

Turning the switch on without a total blocks save until the dialog sets one. People without an allocation share the remaining total capacity. Allocated people are hard-capped individually and still count toward the total. Quota checks add RAGFlow list latency on personal uploads when enabled.

## Testing

OneAPI controller tests cover quota parsing, total and owner rejection messages, and deployment-settings validation. Workbench SystemSettings tests cover the new tab, dialog allocation save, and save blocked without a total. Helper unit tests cover megabyte conversion and normalization.
