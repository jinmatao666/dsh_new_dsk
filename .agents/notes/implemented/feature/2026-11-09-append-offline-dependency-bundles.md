# Agent Note: Append offline dependency bundles

Status: implemented

English | [中文](2026-11-09-append-offline-dependency-bundles.zh.md)

## Problem

Administrators need to supplement a large base wheel ZIP without rebuilding or re-uploading the base. The resource-source selection remains governed by the [intranet resource decision](2026-10-19-intranet-resource-sources.md).

## Decision

OneAPI publishes a versioned catalog of immutable uploads through an atomic file replacement under the persisted resource directory. The upload handler serializes imports and catalog publication within one backend process. The merged pip listing retains each wheel's original content-addressed download URL and SHA-256 fragment. Identical case-insensitive filenames with matching size and hash share one listing; conflicting content rejects publication. Different version filenames coexist, and pip resolves the requested version. The previous single published bundle joins the catalog on the first append; unpublished historical directories do not join it.

## Alternatives considered

Replacing the active bundle requires distributing the large base again. Overwriting same-name wheels breaks immutable URLs and hides inconsistent releases. Requiring one ZIP per feature prevents small incremental deliveries. The catalog instead stores upload metadata separately from immutable files.

## Consequences

Uploads are immediately effective independently of saving resource-source settings. Repeated identical uploads are idempotent. Publication failures preserve the prior catalog. Overlapping uploads can occupy duplicate disk space, and a rejected conflict can leave an unindexed directory; automatic cleanup, deletion, rollback UI, and coordination between multiple backend processes sharing one directory are outside this implementation. Backups must include the catalog and resource directories together.

Focused HTTP tests exercise append, deduplication, conflict rollback, legacy publication, concurrent uploads, and unchanged download links. Real pip tests disable external indexes and caches, install a supplement with a dependency supplied by the base upload, and import both. The opt-in delivery-archive test uploads the operator-provided ZIP, appends a supplement, installs openpyxl and the supplement through the local HTTP listing, and creates a workbook. Installed-desktop task execution through the deployed gateway remains release-operator acceptance; these tests do not exercise that gateway or every binary wheel/Python combination.
