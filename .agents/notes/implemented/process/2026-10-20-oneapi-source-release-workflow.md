# Agent Note: Committed OneAPI source releases

Status: implemented

English | [中文](2026-10-20-oneapi-source-release-workflow.zh.md)

## Problem

Version-specific packaging and deployment scripts require manual edits and can silently collect unrelated work from a shared checkout. A release needs an identifiable source commit and repeatable operator commands without automatically publishing unfinished backend changes.

## Decision

The [release command](../../../../scripts/oneapi-release/release.mjs) packages committed OneAPI files from an explicit Git ref and refuses uncommitted backend changes. It uses a private temporary Git index for archive filtering, leaving the user's staging area intact. The selected commit owns both npm lockfiles, the deployment script and build checks; missing or incompatible lockfiles fail preflight rather than generating floating dependencies during packaging.

Each version has an exclusive output directory, source tar, commit metadata, checksums and generated server commands. The [fixed deployer](../../../../scripts/oneapi-release/deploy-oneapi.sh) parses metadata without shell evaluation, verifies archive contents and image provenance, preserves the established container configuration, and accepts startup only when status reports the requested version. Frontend and backend regression checks live in the committed Dockerfile rather than release-time text substitutions.

The unified repository owns both the offline-resource backend and signed desktop-update publishing. Resource handlers, deployment-setting validation, routes and the admin resource panel coexist with update-package routes and audit actions. Migration from a separate working copy adds only the missing resource functionality; it does not replace the update publisher, dependency versions or colleagues' remote commits. Historical delivery archives remain unchanged.

## Alternatives considered

**Package the current working directory.** This includes unfinished contributions and makes the deployed source difficult to reproduce, so the command requires committed backend files instead.

**Generate a different deployment script for each version.** This duplicates safety fixes and manual substitutions. A metadata-driven script keeps one maintained implementation while recording its exact bytes in each release.

**Require CI and an image registry immediately.** This adds infrastructure and server connectivity requirements. Source packages retain the established server-side Docker build; CI can invoke the same packaging entry later.

## Consequences

Operators still upload the version directory, choose a database backup policy and accept the application after deployment. Container recovery cannot undo database migrations. Offline tests exercise Git packaging, archive rejection, mount preservation and cloned Docker payloads, but real Linux image builds and rollback require server-side verification. Packaging never merges remote changes, commits other contributors' files or updates production.
