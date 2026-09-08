# Agent Note: Dynamic skill release management

Status: implemented

English | [中文](2026-09-07-dynamic-skill-release-management.zh.md)

## Problem

Skill instructions, scripts, and business endpoints changed only through the server image and a desktop metadata projection. Server startup could replace administrator-managed content with checked-in files, so a skill lifecycle change required rebuilding product artifacts.

## Decision

The service stores each complete platform Skill as immutable `skill_releases` records and keeps the selected published release on `skills`. A release version is unique within its Skill, so independent Skills can publish the same semantic version. Import creates a draft from a ZIP after the server checks its UTF-8 root documents, matching kebab-case names, complete manifest file list, ordinary relative paths, size limits, duplicate paths, and SHA-256 digest. The server never executes uploaded files. Publish and rollback select a release transactionally, copy its package into the existing prompt-injection cache fields, and refresh that cache without restarting the container. Unpublish removes the public release from the market without deleting an installed desktop directory.

The management API is administrator-only for import, validation, version history, publication, rollback, and unpublication. Its global administrator-operation middleware records the caller, route, and time. Public metadata and download endpoints expose only published Skills. Desktop increments a download counter only after its native atomic installation succeeds.

The desktop market reads published metadata exclusively from the authenticated server. It downloads a complete file set and server SHA-256, verifies the canonical digest in the native process, validates the manifest, then atomically replaces `.dsh/skills/<slug>`. The local provider notification clears the slash-menu cache, so the current conversation discovers an installation, update, or removal on its next `/` query. Local personal Skills remain marked directories outside the platform API. Presentation Mock entries remain available while the catalogue is sparse, but are marked demonstration-only, cannot be installed or counted, do not appear in the installed list, and disappear when a published Skill owns the same slug.

Skill packages own their scripts, endpoint paths, URL configuration requirements, templates, references, and domain-specific parsing. The platform understands only generic manifest metadata and optional configuration declarations. The GIS sample packages require `DSH_GIS_SERVICE_URL` or an explicit script argument; they contain no fallback public address. The server build excludes checked-in sample packages from runtime assets. Existing published `skills` rows are migrated once into release records and are not overwritten at startup.

This supersedes the server-catalogue and bundled-offline-package portions of [desktop skill installation and dependency grant](../feature/2026-09-01-desktop-skill-install-and-dependency-grant.md). Its local atomic install, personal Skill, dependency-approval, deliverable, and desktop-runtime decisions remain active.

## Alternatives considered

**Keep mutable package bytes only on `skills`** — rejected. It cannot preserve a draft, publish history, or a rollback target.

**Store uploaded packages in the web filesystem** — rejected. Container-local storage is lost during replacement and complicates auditing and backups. The first implementation stores bounded packages in the database while retaining an API that can later use object storage.

**Execute an uploaded script during validation** — rejected. Validation verifies package structure and metadata only; runtime execution belongs on the desktop host under its normal permission model.

**Remove marketplace Mock entries immediately** — rejected. They remain useful presentation fallback until the published catalogue has enough entries, provided they cannot be confused with installable Skills.

## Consequences

An administrator can import a fourth Skill, validate it, publish it, update it, unpublish it, or return to a history entry without rebuilding the server image or desktop installer. The first deployment of this platform capability still requires those artifacts so the API and native SHA-256 verifier exist. New deployments seed no bundled Skill; an administrator imports the desired packages through the release workflow.

The database retains each release package and can grow with both file size and release count. Import limits compressed data to 10 MiB, extracted data to 30 MiB, each file to 5 MiB, 200 files, and eight path levels. A future object-store migration must preserve release IDs, versions, SHA-256 values, and the bundle response fields.

## Verification

Controller tests validate an accepted complete package and reject path escapes and mismatched names. Controller and model package compilation, marketplace type checking, and desktop Rust checks verify the release model, API callers, native digest support, and atomic installation path.
