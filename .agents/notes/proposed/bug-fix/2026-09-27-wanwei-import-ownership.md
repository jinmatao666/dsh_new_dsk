# Agent Note: Native import destination ownership

Status: proposed

English | [中文](2026-09-27-wanwei-import-ownership.zh.md)

## Problem

Checking for an unused destination name does not reserve it. A later native copy can overwrite a concurrently created file, while caller cleanup after directory creation failure can remove an existing directory.

## Proposal

Use exclusive file creation and stream source bytes to that handle. Place directory cleanup after successful exclusive directory creation, inside the owning copy function. Close failed output handles before removing partial files on Windows.

## Alternatives considered

**Check existence again.** Another check still leaves a race before writing.

**Always remove the destination on failure.** The destination may belong to another operation.

## Acceptance criteria

Tests preserve an existing file and directory when the copy refuses a collision, remove a newly created partial directory on failure, and retain Chinese and space-containing names. macOS and Linux native drag behavior still requires device testing.

## Risks

A collision fails explicitly rather than retrying silently. This is not a transactional batch import; previously completed items may remain when a later item fails.
